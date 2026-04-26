import { supabase } from "@/integrations/supabase/client";
import { calculateStuffPlus, type PopConstants, type PitchRow } from "./stuffPlusEngine";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawPitchRow {
  source_player_id: string;
  pitch_type: string;
  hand: string;
  conference: string | null;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  fb_ch_velo_diff: number | null;
}

interface ConfPitchProfile {
  conference: string;
  pitch_type: string;
  hand: string;
  velocity: number;
  ivb: number;
  hb: number;
  rel_height: number;
  rel_side: number;
  extension: number;
  spin: number;
  fb_ch_velo_diff: number | null;
  total_pitches: number;
  pitcher_count: number;
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

function weightedAvg(values: Array<{ val: number | null; w: number }>): number | null {
  let sumV = 0, sumW = 0;
  for (const { val, w } of values) {
    if (val == null) continue;
    sumV += val * w;
    sumW += w;
  }
  return sumW > 0 ? sumV / sumW : null;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function calculateConferenceStuffPlusV2(
  season: number,
): Promise<{ report: ConferenceStuffPlusV2Report; errors: string[] }> {
  const errors: string[] = [];
  console.time("[ConfStuff+V2] TOTAL");

  // ── Pull population constants ──────────────────────────────────────────
  console.time("[ConfStuff+V2] 1. fetch population constants");
  const { data: popData } = await (supabase as any)
    .from("pitcher_stuff_plus_ncaa")
    .select("*")
    .eq("season", season);
  console.timeEnd("[ConfStuff+V2] 1. fetch population constants");

  if (!popData || popData.length === 0) {
    return { report: { overall: [], written: 0 }, errors: ["No population constants found"] };
  }

  const popMap = new Map<string, PopConstants>();
  for (const p of popData as PopConstants[]) {
    popMap.set(`${p.pitch_type}::${p.hand}`, p);
  }

  // ── Step 1: Pull all pitch-level data ──────────────────────────────────
  console.time("[ConfStuff+V2] 2. fetch pitch rows");
  const allRows = await fetchAll<RawPitchRow>(
    "pitcher_stuff_plus_inputs",
    "source_player_id, pitch_type, hand, conference, pitches, velocity, ivb, hb, rel_height, rel_side, extension, spin, fb_ch_velo_diff",
    (q: any) => q.eq("season", season).not("ivb", "is", null).not("hb", "is", null).gt("pitches", 0),
  );

  console.timeEnd("[ConfStuff+V2] 2. fetch pitch rows");

  if (allRows.length === 0) {
    return { report: { overall: [], written: 0 }, errors: ["No pitch data found"] };
  }

  // ── Step 2: Group by conference + pitch_type + hand → weighted profiles
  console.time("[ConfStuff+V2] 3. group + compute profiles");
  type GroupKey = string; // "conference::pitch_type::hand"
  const groups = new Map<GroupKey, RawPitchRow[]>();

  for (const row of allRows) {
    if (!row.conference) continue;
    const key = `${row.conference}::${row.pitch_type}::${row.hand}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Build weighted profiles per (conference, pitch_type, hand)
  const profiles: ConfPitchProfile[] = [];
  for (const [key, rows] of groups) {
    const [conference, pitch_type, hand] = key.split("::");
    const items = rows.map((r) => ({ ...r, p: r.pitches ?? 0 })).filter((r) => r.p > 0);
    if (items.length === 0) continue;

    const totalP = items.reduce((s, r) => s + r.p, 0);
    const wAvg = (getter: (r: RawPitchRow) => number | null) =>
      weightedAvg(items.map((r) => ({ val: getter(r), w: r.p })));

    const vel = wAvg((r) => r.velocity);
    const ivb = wAvg((r) => r.ivb);
    const hb = wAvg((r) => r.hb);
    const relH = wAvg((r) => r.rel_height);
    const relS = wAvg((r) => r.rel_side);
    const ext = wAvg((r) => r.extension);
    const spin = wAvg((r) => r.spin);
    const veloDiff = pitch_type === "Change-up" ? wAvg((r) => r.fb_ch_velo_diff) : null;

    if (vel == null || ivb == null || hb == null) continue;

    const uniquePitchers = new Set(items.map((r) => r.source_player_id));

    profiles.push({
      conference,
      pitch_type,
      hand,
      velocity: vel,
      ivb,
      hb,
      rel_height: relH ?? 0,
      rel_side: relS ?? 0,
      extension: ext ?? 0,
      spin: spin ?? 0,
      fb_ch_velo_diff: veloDiff,
      total_pitches: totalP,
      pitcher_count: uniquePitchers.size,
    });
  }

  console.timeEnd("[ConfStuff+V2] 3. group + compute profiles");

  // ── Step 3: Run profiles through Stuff+ equations ──────────────────────
  console.time("[ConfStuff+V2] 4. score profiles");
  // Group profiles by (conference, pitch_type) to blend RHP + LHP
  const confPitchGroups = new Map<string, ConfPitchProfile[]>();
  for (const p of profiles) {
    const key = `${p.conference}::${p.pitch_type}`;
    if (!confPitchGroups.has(key)) confPitchGroups.set(key, []);
    confPitchGroups.get(key)!.push(p);
  }

  const pitchResults: ConfPitchResult[] = [];

  for (const [key, handProfiles] of confPitchGroups) {
    const [conference, pitch_type] = key.split("::");

    let totalWeightedScore = 0;
    let totalPitches = 0;
    const allPitcherIds = new Set<string>();

    for (const profile of handProfiles) {
      const popKey = `${pitch_type}::${profile.hand}`;
      const pop = popMap.get(popKey);
      if (!pop) continue;

      // Build a synthetic PitchRow for the equation
      const syntheticRow: PitchRow = {
        id: "",
        source_player_id: "",
        pitch_type,
        hand: profile.hand,
        pitches: profile.total_pitches,
        velocity: profile.velocity,
        ivb: profile.ivb,
        hb: profile.hb,
        rel_height: profile.rel_height,
        rel_side: profile.rel_side,
        extension: profile.extension,
        spin: profile.spin,
        fb_ch_velo_diff: profile.fb_ch_velo_diff,
        needs_review: false,
      };

      const result = calculateStuffPlus(pitch_type, syntheticRow, pop);
      if (!result) continue;

      totalWeightedScore += result.score * profile.total_pitches;
      totalPitches += profile.total_pitches;

      // Collect pitcher IDs from the raw rows for this hand
      const rawKey = `${conference}::${pitch_type}::${profile.hand}`;
      const rawRows = groups.get(rawKey) ?? [];
      for (const r of rawRows) allPitcherIds.add(r.source_player_id);
    }

    if (totalPitches === 0) continue;

    const blendedScore = Math.round((totalWeightedScore / totalPitches) * 10) / 10;

    pitchResults.push({
      conference,
      pitch_type,
      stuff_plus: blendedScore,
      total_pitches: totalPitches,
      pitcher_count: allPitcherIds.size,
      thin_sample: allPitcherIds.size < 3,
    });
  }

  console.timeEnd("[ConfStuff+V2] 4. score profiles");

  // ── Step 4: Overall conference Stuff+ ──────────────────────────────────
  console.time("[ConfStuff+V2] 5. compute overall");
  const confOverall = new Map<string, {
    totalWeighted: number;
    totalPitches: number;
    pitcherIds: Set<string>;
    byPitch: Record<string, { stuff_plus: number; pitches: number } | null>;
  }>();

  for (const pr of pitchResults) {
    if (!confOverall.has(pr.conference)) {
      confOverall.set(pr.conference, {
        totalWeighted: 0,
        totalPitches: 0,
        pitcherIds: new Set(),
        byPitch: {},
      });
    }
    const entry = confOverall.get(pr.conference)!;
    entry.totalWeighted += pr.stuff_plus * pr.total_pitches;
    entry.totalPitches += pr.total_pitches;
    entry.byPitch[pr.pitch_type] = { stuff_plus: pr.stuff_plus, pitches: pr.total_pitches };

    // Add pitcher IDs
    const rawKeys = profiles
      .filter((p) => p.conference === pr.conference && p.pitch_type === pr.pitch_type)
      .flatMap((p) => {
        const rawKey = `${pr.conference}::${pr.pitch_type}::${p.hand}`;
        return (groups.get(rawKey) ?? []).map((r) => r.source_player_id);
      });
    for (const id of rawKeys) entry.pitcherIds.add(id);
  }

  const overallResults: ConfOverallResult[] = [];
  for (const [conference, entry] of confOverall) {
    if (entry.totalPitches === 0) continue;
    overallResults.push({
      conference,
      overall: Math.round((entry.totalWeighted / entry.totalPitches) * 10) / 10,
      totalPitches: entry.totalPitches,
      pitcherCount: entry.pitcherIds.size,
      byPitch: entry.byPitch,
    });
  }
  overallResults.sort((a, b) => b.overall - a.overall);

  console.timeEnd("[ConfStuff+V2] 5. compute overall");

  // ── Step 5: Write to Conference Stats ──────────────────────────────────
  console.time("[ConfStuff+V2] 6. write to Conference Stats");
  let written = 0;

  for (const r of overallResults) {
    const updatePayload: Record<string, any> = {
      Stuff_plus: r.overall,
    };

    // Per pitch type columns
    for (const pt of ALL_PITCH_TYPES) {
      const colKey = PITCH_COL_KEYS[pt];
      const pitchData = r.byPitch[pt];
      updatePayload[`stuff_plus_v2_${colKey}`] = pitchData?.stuff_plus ?? null;
      updatePayload[`pitches_v2_${colKey}`] = pitchData?.pitches ?? null;
    }

    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update(updatePayload)
      .eq("conference abbreviation", r.conference)
      .eq("season", season);

    if (error) {
      // If columns don't exist yet, just write the overall
      const { error: fallbackErr } = await (supabase as any)
        .from("Conference Stats")
        .update({ Stuff_plus: r.overall })
        .eq("conference abbreviation", r.conference)
        .eq("season", season);

      if (fallbackErr) {
        errors.push(`Update ${r.conference}: ${fallbackErr.message}`);
      } else {
        written++;
      }
    } else {
      written++;
    }
  }

  console.timeEnd("[ConfStuff+V2] 6. write to Conference Stats");
  console.timeEnd("[ConfStuff+V2] TOTAL");

  return {
    report: { overall: overallResults, written },
    errors,
  };
}
