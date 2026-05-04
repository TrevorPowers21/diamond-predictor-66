import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScoredPitchRow {
  source_player_id: string;
  pitch_type: string;
  hand: string;
  conference: string | null;
  pitches: number | null;
  stuff_plus: number | null;
}

interface ConfPitchResult {
  conference: string;
  pitch_type: string;
  stuff_plus: number;
  total_pitches: number;
  pitcher_count: number;
  thin_sample: boolean;
}

export interface ConfOverallResult {
  conference_id: string;
  conference: string;
  overall: number;
  totalPitches: number;
  pitcherCount: number;
  byPitch: Record<string, { stuff_plus: number; pitches: number } | null>;
}

export interface ConferenceStuffPlusV2Report {
  overall: ConfOverallResult[];
  written: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALL_PITCH_TYPES = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];

const PITCH_COL_KEYS: Record<string, string> = {
  "4S FB": "4sfb",
  Sinker: "sinker",
  Cutter: "cutter",
  "Gyro Slider": "gyro_slider",
  Slider: "slider",
  Sweeper: "sweeper",
  Curveball: "curveball",
  "Change-up": "changeup",
  Splitter: "splitter",
};

async function fetchAll<T>(
  table: string,
  select: string,
  filters: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let q = (supabase as any).from(table).select(select).range(offset, offset + PAGE - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function calculateConferenceStuffPlusV2(
  season: number,
): Promise<{ report: ConferenceStuffPlusV2Report; errors: string[] }> {
  const errors: string[] = [];
  console.time("[ConfStuff+V2] TOTAL");

  // ── Pull per-pitcher scored rows. Each row already has a Stuff+ value
  // computed by the Stuff+ engine for that specific (pitcher, pitch_type,
  // hand). We aggregate those individual scores — never a synthetic profile.
  console.time("[ConfStuff+V2] 1. fetch scored rows");
  const allRows = await fetchAll<ScoredPitchRow>(
    "pitcher_stuff_plus_inputs",
    "source_player_id, pitch_type, hand, conference, pitches, stuff_plus",
    (q: any) =>
      q
        .eq("season", season)
        .not("stuff_plus", "is", null)
        .gt("pitches", 0),
  );
  console.timeEnd("[ConfStuff+V2] 1. fetch scored rows");

  if (allRows.length === 0) {
    return { report: { overall: [], written: 0 }, errors: ["No scored pitch data found — run Stuff+ first"] };
  }

  // ── Pull conference_id mapping from Pitching Master ─────────────────────
  // pitcher_stuff_plus_inputs only has the string conference name, but
  // Conference Stats keys by conference_id (UUID). Build source_player_id →
  // conference_id map so we can update by ID, not by name.
  console.time("[ConfStuff+V2] 1b. fetch conference_id map");
  const confIdBySourceId = new Map<string, string>();
  let pmFrom = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, conference_id")
      .eq("Season", season)
      .order("source_player_id", { ascending: true })
      .range(pmFrom, pmFrom + 999);
    if (error || !data || data.length === 0) break;
    for (const r of data as any[]) {
      if (r.source_player_id && r.conference_id) {
        confIdBySourceId.set(r.source_player_id, r.conference_id);
      }
    }
    if (data.length < 1000) break;
    pmFrom += 1000;
  }
  console.timeEnd("[ConfStuff+V2] 1b. fetch conference_id map");

  // ── Per-pitcher composite per (conf_id × pitch_type × hand) ────────────
  // Key by conference_id (UUID) so cross-naming variations don't break matching.
  console.time("[ConfStuff+V2] 2. aggregate by conf × pitch × hand");
  const labelByConfId = new Map<string, string>();
  const bucketRows = new Map<string, ScoredPitchRow[]>();
  for (const r of allRows) {
    if (r.stuff_plus == null) continue;
    const cid = confIdBySourceId.get(r.source_player_id);
    if (!cid) continue;
    if (r.conference && !labelByConfId.has(cid)) labelByConfId.set(cid, r.conference);
    const key = `${cid}::${r.pitch_type}::${r.hand}`;
    if (!bucketRows.has(key)) bucketRows.set(key, []);
    bucketRows.get(key)!.push(r);
  }
  console.timeEnd("[ConfStuff+V2] 2. aggregate by conf × pitch × hand");

  // ── Blend RHP + LHP within (conf_id × pitch_type), pitch-weighted ──────
  console.time("[ConfStuff+V2] 3. blend hands → conf × pitch");
  const confPitchAgg = new Map<string, { weighted: number; pitches: number; pitcherIds: Set<string> }>();
  for (const [key, rows] of bucketRows) {
    const [confId, pitch_type] = key.split("::");
    const confPitchKey = `${confId}::${pitch_type}`;
    if (!confPitchAgg.has(confPitchKey)) {
      confPitchAgg.set(confPitchKey, { weighted: 0, pitches: 0, pitcherIds: new Set() });
    }
    const agg = confPitchAgg.get(confPitchKey)!;
    for (const r of rows) {
      const w = r.pitches ?? 0;
      if (w <= 0) continue;
      agg.weighted += Number(r.stuff_plus) * w;
      agg.pitches += w;
      agg.pitcherIds.add(r.source_player_id);
    }
  }

  type PitchResultByConfId = ConfPitchResult & { conference_id: string };
  const pitchResults: PitchResultByConfId[] = [];
  for (const [key, agg] of confPitchAgg) {
    if (agg.pitches === 0) continue;
    const [confId, pitch_type] = key.split("::");
    pitchResults.push({
      conference_id: confId,
      conference: labelByConfId.get(confId) ?? confId,
      pitch_type,
      stuff_plus: Math.round((agg.weighted / agg.pitches) * 10) / 10,
      total_pitches: agg.pitches,
      pitcher_count: agg.pitcherIds.size,
      thin_sample: agg.pitcherIds.size < 3,
    });
  }
  console.timeEnd("[ConfStuff+V2] 3. blend hands → conf × pitch");

  // ── Conference overall — pitch-weighted across all pitch types ─────────
  console.time("[ConfStuff+V2] 4. compute conf overall");
  const confOverall = new Map<string, {
    totalWeighted: number;
    totalPitches: number;
    pitcherIds: Set<string>;
    byPitch: Record<string, { stuff_plus: number; pitches: number } | null>;
  }>();

  for (const pr of pitchResults) {
    if (!confOverall.has(pr.conference_id)) {
      confOverall.set(pr.conference_id, {
        totalWeighted: 0,
        totalPitches: 0,
        pitcherIds: new Set(),
        byPitch: {},
      });
    }
    const entry = confOverall.get(pr.conference_id)!;
    entry.totalWeighted += pr.stuff_plus * pr.total_pitches;
    entry.totalPitches += pr.total_pitches;
    entry.byPitch[pr.pitch_type] = { stuff_plus: pr.stuff_plus, pitches: pr.total_pitches };
  }

  // Pitcher IDs across the whole conference
  for (const r of allRows) {
    const cid = confIdBySourceId.get(r.source_player_id);
    if (!cid) continue;
    const entry = confOverall.get(cid);
    if (entry) entry.pitcherIds.add(r.source_player_id);
  }

  const overallResults: ConfOverallResult[] = [];
  for (const [confId, entry] of confOverall) {
    if (entry.totalPitches === 0) continue;
    overallResults.push({
      conference_id: confId,
      conference: labelByConfId.get(confId) ?? confId,
      overall: Math.round((entry.totalWeighted / entry.totalPitches) * 10) / 10,
      totalPitches: entry.totalPitches,
      pitcherCount: entry.pitcherIds.size,
      byPitch: entry.byPitch,
    });
  }
  overallResults.sort((a, b) => b.overall - a.overall);
  console.timeEnd("[ConfStuff+V2] 4. compute conf overall");

  // ── Write to Conference Stats ──────────────────────────────────────────
  console.time("[ConfStuff+V2] 5. write to Conference Stats");
  let written = 0;
  for (const r of overallResults) {
    const updatePayload: Record<string, any> = { Stuff_plus: r.overall };
    for (const pt of ALL_PITCH_TYPES) {
      const colKey = PITCH_COL_KEYS[pt];
      const pitchData = r.byPitch[pt];
      updatePayload[`stuff_plus_v2_${colKey}`] = pitchData?.stuff_plus ?? null;
      updatePayload[`pitches_v2_${colKey}`] = pitchData?.pitches ?? null;
    }

    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update(updatePayload)
      .eq("conference_id", r.conference_id)
      .eq("season", season);

    if (error) {
      const { error: fallbackErr } = await (supabase as any)
        .from("Conference Stats")
        .update({ Stuff_plus: r.overall })
        .eq("conference_id", r.conference_id)
        .eq("season", season);
      if (fallbackErr) errors.push(`Update ${r.conference}: ${fallbackErr.message}`);
      else written++;
    } else {
      written++;
    }
  }
  console.timeEnd("[ConfStuff+V2] 5. write to Conference Stats");
  console.timeEnd("[ConfStuff+V2] TOTAL");

  return { report: { overall: overallResults, written }, errors };
}
