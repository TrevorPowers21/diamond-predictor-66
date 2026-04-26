import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConferenceResult {
  conference: string;
  stuffPlus: number;
  pitcherCount: number;
  totalPitches: number;
  thinSample: boolean;
}

export interface ConferenceStuffPlusReport {
  results: ConferenceResult[];
  written: number;
}

// ─── Paginated fetch ────────────────────────────────────────────────────────

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

// ─── Main Function ──────────────────────────────────────────────────────────

export async function calculateConferenceStuffPlus(
  season: number,
): Promise<{ report: ConferenceStuffPlusReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[ConfStuff+V1] TOTAL");

  // ── Step 1: Pull all pitchers with overall Stuff+ for the season ────────
  console.time("[ConfStuff+V1] 1. fetch pitchers + pitch rows");
  // Get stuff_plus (overall composite) from Pitching Master
  const pitchers = await fetchAll<{
    source_player_id: string;
    playerFullName: string;
    Team: string | null;
    Conference: string | null;
    stuff_plus: number | null;
  }>(
    "Pitching Master",
    "source_player_id, playerFullName, Team, Conference, stuff_plus",
    (q: any) => q.eq("Season", season).not("stuff_plus", "is", null),
  );

  if (pitchers.length === 0) {
    return { report: { results: [], written: 0 }, errors: ["No pitchers with Stuff+ found for this season"] };
  }

  // Get total pitches per pitcher from pitcher_stuff_plus_inputs
  const pitchRows = await fetchAll<{
    source_player_id: string;
    pitches: number | null;
  }>(
    "pitcher_stuff_plus_inputs",
    "source_player_id, pitches",
    (q: any) => q.eq("season", season).gte("pitches", 5),
  );

  // Sum total pitches per pitcher
  const pitcherTotalPitches = new Map<string, number>();
  for (const r of pitchRows) {
    const cur = pitcherTotalPitches.get(r.source_player_id) ?? 0;
    pitcherTotalPitches.set(r.source_player_id, cur + (r.pitches ?? 0));
  }

  console.timeEnd("[ConfStuff+V1] 1. fetch pitchers + pitch rows");

  // ── Step 2: Group by conference, calculate weighted Stuff+ ─────────────
  console.time("[ConfStuff+V1] 2. group + compute weighted stuff+");
  const confGroups = new Map<string, Array<{ stuffPlus: number; totalPitches: number; name: string }>>();

  for (const p of pitchers) {
    if (!p.Conference || p.stuff_plus == null) continue;
    const totalP = pitcherTotalPitches.get(p.source_player_id) ?? 0;
    if (totalP === 0) continue;

    if (!confGroups.has(p.Conference)) confGroups.set(p.Conference, []);
    confGroups.get(p.Conference)!.push({
      stuffPlus: p.stuff_plus,
      totalPitches: totalP,
      name: p.playerFullName,
    });
  }

  const results: ConferenceResult[] = [];

  for (const [conference, pitcherList] of confGroups) {
    const totalPitches = pitcherList.reduce((s, p) => s + p.totalPitches, 0);
    const weightedSum = pitcherList.reduce((s, p) => s + p.stuffPlus * p.totalPitches, 0);
    const stuffPlus = totalPitches > 0 ? Math.round((weightedSum / totalPitches) * 10) / 10 : 0;

    results.push({
      conference,
      stuffPlus,
      pitcherCount: pitcherList.length,
      totalPitches,
      thinSample: pitcherList.length < 3,
    });
  }

  results.sort((a, b) => b.stuffPlus - a.stuffPlus);

  console.timeEnd("[ConfStuff+V1] 2. group + compute weighted stuff+");

  // ── Step 3: Upsert to Conference Stats table ───────────────────────────
  console.time("[ConfStuff+V1] 3. write to Conference Stats");
  let written = 0;

  for (const r of results) {
    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update({
        Stuff_plus: r.stuffPlus,
      })
      .eq("conference abbreviation", r.conference)
      .eq("season", season);

    if (error) {
      errors.push(`Update ${r.conference}: ${error.message}`);
    } else {
      written++;
    }
  }

  console.timeEnd("[ConfStuff+V1] 3. write to Conference Stats");
  console.timeEnd("[ConfStuff+V1] TOTAL");

  return {
    report: { results, written },
    errors,
  };
}
