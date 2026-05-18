import { supabase } from "@/integrations/supabase/client";

// Hitter metric → Hitter Master column. Weighted by PA (AB fallback).
// Note: OPS is derived (OBP + SLG), handled separately below.
const HITTER_METRICS: Array<{ ncaa: string; col: string }> = [
  { ncaa: "avg", col: "AVG" },
  { ncaa: "obp", col: "OBP" },
  { ncaa: "slg", col: "SLG" },
  { ncaa: "iso", col: "ISO" },
  { ncaa: "contact_pct", col: "contact" },
  { ncaa: "bb_pct", col: "bb" },
  { ncaa: "chase_pct", col: "chase" },
  { ncaa: "barrel_pct", col: "barrel" },
  { ncaa: "exit_velo", col: "avg_exit_velo" },
  { ncaa: "ev90", col: "ev90" },
  { ncaa: "ground_pct", col: "gb" },
  { ncaa: "pull_pct", col: "pull" },
  { ncaa: "la_10_30_pct", col: "la_10_30" },
  { ncaa: "line_drive_pct", col: "line_drive" },
  { ncaa: "pop_up_pct", col: "pop_up" },
];

// Pitcher metric → Pitching Master column. Weighted by IP.
// stuff_plus is handled separately — weighted by total pitches per pitcher,
// summed from pitcher_stuff_plus_inputs (per pitch type × hand).
const PITCHER_METRICS: Array<{ ncaa: string; col: string }> = [
  { ncaa: "era", col: "ERA" },
  { ncaa: "fip", col: "FIP" },
  { ncaa: "whip", col: "WHIP" },
  { ncaa: "k9", col: "K9" },
  { ncaa: "bb9", col: "BB9" },
  { ncaa: "hr9", col: "HR9" },
  { ncaa: "pitcher_whiff_pct", col: "miss_pct" },
  { ncaa: "pitcher_chase_pct", col: "chase_pct" },
  { ncaa: "pitcher_iz_whiff_pct", col: "in_zone_whiff_pct" },
  { ncaa: "pitcher_bb_pct", col: "bb_pct" },
  { ncaa: "pitcher_barrel_pct", col: "barrel_pct" },
  { ncaa: "pitcher_hard_hit_pct", col: "hard_hit_pct" },
  { ncaa: "pitcher_ev90", col: "90th_vel" },
  { ncaa: "pitcher_ground_pct", col: "ground_pct" },
  { ncaa: "pitcher_pull_pct", col: "h_pull_pct" },
  { ncaa: "pitcher_la_10_30_pct", col: "la_10_30_pct" },
  { ncaa: "pitcher_line_drive_pct", col: "line_pct" },
];

// Mean = PA/IP-weighted across the full population (every plate appearance
// or inning contributes proportionally — this is the standard baseball
// "league average per PA" / "league average per IP" convention).
function calcWeightedMean(
  rows: Array<{ value: number; weight: number }>,
): number | null {
  if (rows.length === 0) return null;
  const totalW = rows.reduce((s, r) => s + r.weight, 0);
  if (totalW === 0) return null;
  return rows.reduce((s, r) => s + r.value * r.weight, 0) / totalW;
}

// SD = unweighted across QUALIFIED players only (AB ≥ 75 hitters, IP ≥ 25
// pitchers). Removes small-sample noise — a 5-AB player going 1-for-5 with
// 100% barrel% has nothing to do with talent variance, and including them
// inflates the SD. Sample variance (Bessel's correction: divide by n-1).
function calcQualifiedSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

async function fetchAllRows(
  table: string,
  select: string,
  season: number,
  seasonCol: string = "Season",
  /**
   * If the table has a `division` column (Hitter/Pitching Master post-JUCO
   * scaffold migration), filter to this division. Pass null to disable for
   * tables that don't have the column (e.g., pitcher_stuff_plus_inputs).
   * Default 'D1' so NCAA averages stay D1-only after JUCO data lands.
   */
  divisionFilter: string | null = "D1",
): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let offset = 0;
  while (true) {
    let q = (supabase as any).from(table).select(select).eq(seasonCol, season);
    if (divisionFilter) q = q.eq("division", divisionFilter);
    q = q.range(offset, offset + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function computeAndStoreNcaaAverages(season: number): Promise<{
  hittersUsed: number;
  pitchersUsed: number;
  fieldsWritten: number;
  errors: string[];
}> {
  const errors: string[] = [];
  console.time("[NcaaAvg] TOTAL");

  // ─── Hitters ──────────────────────────────────────────────────────────
  console.time("[NcaaAvg] 1. fetch hitters");
  const hitterCols = ["pa", "ab", ...HITTER_METRICS.map((m) => `"${m.col}"`)].join(", ");
  const hitters = await fetchAllRows("Hitter Master", hitterCols, season);
  console.timeEnd("[NcaaAvg] 1. fetch hitters");
  console.log(`[NcaaAvg] ${hitters.length} hitter rows for ${season}`);

  console.time("[NcaaAvg] 2. compute hitter stats");
  const updates: Record<string, number | null> = { season };
  // Hybrid approach: PA-weighted means (true league avg per PA) + qualified-only
  // SDs (true talent variance, no small-sample noise). AB ≥ 75 = qualified.
  const QUALIFIED_AB = 75;
  for (const m of HITTER_METRICS) {
    const weightedRows: Array<{ value: number; weight: number }> = [];
    const qualifiedValues: number[] = [];
    for (const r of hitters) {
      const v = (r as any)[m.col];
      if (v == null || !Number.isFinite(Number(v))) continue;
      const value = Number(v);
      const pa = Number((r as any).pa);
      const ab = Number((r as any).ab);
      const w = Number.isFinite(pa) && pa > 0 ? pa : Number.isFinite(ab) && ab > 0 ? ab : 0;
      if (w > 0) weightedRows.push({ value, weight: w });
      if (Number.isFinite(ab) && ab >= QUALIFIED_AB) qualifiedValues.push(value);
    }
    const mean = calcWeightedMean(weightedRows);
    const sd = calcQualifiedSd(qualifiedValues);
    updates[m.ncaa] = mean != null ? Math.round(mean * 10000) / 10000 : null;
    updates[`${m.ncaa}_sd`] = sd != null ? Math.round(sd * 100000) / 100000 : null;
  }

  // OPS — derived per-row as OBP + SLG. PA-weighted mean, qualified-only SD.
  const opsWeighted: Array<{ value: number; weight: number }> = [];
  const opsQualified: number[] = [];
  for (const r of hitters) {
    const obp = Number((r as any).OBP);
    const slg = Number((r as any).SLG);
    if (!Number.isFinite(obp) || !Number.isFinite(slg)) continue;
    const value = obp + slg;
    const pa = Number((r as any).pa);
    const ab = Number((r as any).ab);
    const w = Number.isFinite(pa) && pa > 0 ? pa : Number.isFinite(ab) && ab > 0 ? ab : 0;
    if (w > 0) opsWeighted.push({ value, weight: w });
    if (Number.isFinite(ab) && ab >= QUALIFIED_AB) opsQualified.push(value);
  }
  const opsMean = calcWeightedMean(opsWeighted);
  const opsSd = calcQualifiedSd(opsQualified);
  updates["ops"] = opsMean != null ? Math.round(opsMean * 10000) / 10000 : null;
  updates["ops_sd"] = opsSd != null ? Math.round(opsSd * 100000) / 100000 : null;
  console.timeEnd("[NcaaAvg] 2. compute hitter stats");

  // ─── Pitchers ─────────────────────────────────────────────────────────
  console.time("[NcaaAvg] 3. fetch pitchers");
  const pitcherCols = ["source_player_id", `"IP"`, "stuff_plus", ...PITCHER_METRICS.map((m) => `"${m.col}"`)].join(", ");
  const pitchers = await fetchAllRows("Pitching Master", pitcherCols, season);
  console.timeEnd("[NcaaAvg] 3. fetch pitchers");
  console.log(`[NcaaAvg] ${pitchers.length} pitcher rows for ${season}`);

  console.time("[NcaaAvg] 4. compute pitcher stats");
  const QUALIFIED_IP = 25;
  for (const m of PITCHER_METRICS) {
    const weightedRows: Array<{ value: number; weight: number }> = [];
    const qualifiedValues: number[] = [];
    for (const r of pitchers) {
      const v = (r as any)[m.col];
      if (v == null || !Number.isFinite(Number(v))) continue;
      const value = Number(v);
      const ip = Number((r as any).IP);
      if (Number.isFinite(ip) && ip > 0) weightedRows.push({ value, weight: ip });
      if (Number.isFinite(ip) && ip >= QUALIFIED_IP) qualifiedValues.push(value);
    }
    const mean = calcWeightedMean(weightedRows);
    const sd = calcQualifiedSd(qualifiedValues);
    updates[m.ncaa] = mean != null ? Math.round(mean * 10000) / 10000 : null;
    updates[`${m.ncaa}_sd`] = sd != null ? Math.round(sd * 100000) / 100000 : null;
  }
  console.timeEnd("[NcaaAvg] 4. compute pitcher stats");

  // ─── Stuff+ — weighted by total pitches per pitcher ──────────────────
  // Sum pitches from pitcher_stuff_plus_inputs (per pitch type × hand) to get
  // each pitcher's total pitch count, then use that as the weight on the
  // pitcher-level stuff_plus value in Pitching Master.
  console.time("[NcaaAvg] 4b. stuff+ weighted by pitches");
  // pitcher_stuff_plus_inputs doesn't have a division column yet (added
  // separately later). Pass null to skip the division filter; the join via
  // source_player_id below naturally restricts to D1 pitchers because the
  // outer `pitchers` set is already D1-filtered.
  const pitchInputs = await fetchAllRows(
    "pitcher_stuff_plus_inputs",
    "source_player_id, pitches",
    season,
    "season",
    null,
  ).catch(() => [] as any[]);
  const pitchesByPitcher = new Map<string, number>();
  for (const r of pitchInputs) {
    const sid = (r as any).source_player_id;
    const p = Number((r as any).pitches);
    if (!sid || !Number.isFinite(p) || p <= 0) continue;
    pitchesByPitcher.set(sid, (pitchesByPitcher.get(sid) ?? 0) + p);
  }
  const stuffWeighted: Array<{ value: number; weight: number }> = [];
  const stuffQualified: number[] = [];
  for (const r of pitchers) {
    const sid = (r as any).source_player_id;
    const v = (r as any).stuff_plus;
    if (v == null || !Number.isFinite(Number(v))) continue;
    const value = Number(v);
    const w = sid ? (pitchesByPitcher.get(sid) ?? 0) : 0;
    const ip = Number((r as any).IP);
    if (w > 0) stuffWeighted.push({ value, weight: w });
    if (Number.isFinite(ip) && ip >= QUALIFIED_IP) stuffQualified.push(value);
  }
  const stuffMean = calcWeightedMean(stuffWeighted);
  const stuffSd = calcQualifiedSd(stuffQualified);
  updates["stuff_plus"] = stuffMean != null ? Math.round(stuffMean * 10000) / 10000 : null;
  updates["stuff_plus_sd"] = stuffSd != null ? Math.round(stuffSd * 100000) / 100000 : null;
  console.log(`[NcaaAvg] stuff+: ${stuffWeighted.length} weighted / ${stuffQualified.length} qualified pitchers, totalPitches=${[...pitchesByPitcher.values()].reduce((s, v) => s + v, 0)}`);
  console.timeEnd("[NcaaAvg] 4b. stuff+ weighted by pitches");

  // ─── Upsert ───────────────────────────────────────────────────────────
  console.time("[NcaaAvg] 5. upsert");
  const { error } = await (supabase as any)
    .from("ncaa_averages")
    .upsert([updates], { onConflict: "season" });
  if (error) errors.push(`Upsert: ${error.message}`);
  console.timeEnd("[NcaaAvg] 5. upsert");
  console.timeEnd("[NcaaAvg] TOTAL");

  return {
    hittersUsed: hitters.length,
    pitchersUsed: pitchers.length,
    fieldsWritten: Object.keys(updates).length - 1, // minus season
    errors,
  };
}
