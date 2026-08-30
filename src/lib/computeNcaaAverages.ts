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
// stuff_plus is handled separately — weighted by each pitcher's SCORED pitch count
// from the LIVE pitch_log lane (pitch_log_pitcher_totals.stuff_plus_data_pitches at
// dimension_key='all'). NOT from the legacy pitcher_stuff_plus_inputs table.
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
  { ncaa: "pitcher_in_zone_pct", col: "in_zone_pct" },
  { ncaa: "pitcher_ground_pct", col: "ground_pct" },
  { ncaa: "pitcher_pull_pct", col: "h_pull_pct" },
  { ncaa: "pitcher_la_10_30_pct", col: "la_10_30_pct" },
  { ncaa: "pitcher_line_drive_pct", col: "line_pct" },
];

// ─────────────────────────────────────────────────────────────────────────
// model_config mirror. Trevor's directive: NCAA averages must be stored
// IDENTICALLY in BOTH `ncaa_averages` (canonical row) AND `model_config`
// (the per-key store the scoring/projection readers actually consume). Mean
// AND SD for every metric — never neglect the SDs.
//
// Each entry maps one `ncaa_averages` column (mean) + its `<col>_sd` column
// to the model_config key names the readers already expect. Key-name
// conventions are NOT uniform, so this map is explicit (not derived):
//   • Pitcher scoring: mean = `p_ncaa_avg_<x>`, sd = `p_sd_<x>`
//     (consumed by pitcherProjection.ts calcScore(...) via loadPitchingPowerEq;
//      the SD reader convention is `p_sd_*`, NOT `p_ncaa_sd_*`).
//   • Returner hitting: mean = `r_ncaa_avg_<ba|obp|iso>`, sd = `r_<ba|obp>_std_ncaa`.
//   • Transfer hitting: mean = `t_<ba|obp|iso>_ncaa_avg`, sd = `t_<ba|obp|iso>_std_ncaa`.
// All rows are written under model_type='admin_ui' at the given season, upserted
// on the natural key (model_type, season, config_key).
//
// NOTE (out of scope — intentionally NOT written here):
//   • Power-rating baselines (`p_*_power_rating` = 50/100, `*_std_pr`, `t_iso_std_power`)
//     are normalizers, not population means from this job.
//   • wRC scale constant (`r_ncaa_avg_wrc` / `t_wrc_*` = 0.3782) is a locked
//     wOBA-scale constant, not a population mean this job computes.
const MODEL_CONFIG_MEAN_SD_MAP: Array<{
  ncaaCol: string; // column on the `updates`/`ncaa_averages` row (mean)
  meanKey: string; // model_config key for the mean
  sdKey?: string; // model_config key for the SD (reads `<ncaaCol>_sd`)
}> = [
  // ── Pitcher scoring means (p_ncaa_avg_*) + SDs (p_sd_*) ──
  { ncaaCol: "stuff_plus", meanKey: "p_ncaa_avg_stuff_plus", sdKey: "p_sd_stuff_plus" },
  { ncaaCol: "pitcher_whiff_pct", meanKey: "p_ncaa_avg_whiff_pct", sdKey: "p_sd_whiff_pct" },
  { ncaaCol: "pitcher_bb_pct", meanKey: "p_ncaa_avg_bb_pct", sdKey: "p_sd_bb_pct" },
  { ncaaCol: "pitcher_hard_hit_pct", meanKey: "p_ncaa_avg_hh_pct", sdKey: "p_sd_hh_pct" },
  { ncaaCol: "pitcher_iz_whiff_pct", meanKey: "p_ncaa_avg_in_zone_whiff_pct", sdKey: "p_sd_in_zone_whiff_pct" },
  { ncaaCol: "pitcher_chase_pct", meanKey: "p_ncaa_avg_chase_pct", sdKey: "p_sd_chase_pct" },
  { ncaaCol: "pitcher_barrel_pct", meanKey: "p_ncaa_avg_barrel_pct", sdKey: "p_sd_barrel_pct" },
  { ncaaCol: "pitcher_line_drive_pct", meanKey: "p_ncaa_avg_ld_pct", sdKey: "p_sd_ld_pct" },
  { ncaaCol: "pitcher_exit_velo", meanKey: "p_ncaa_avg_avg_ev", sdKey: "p_sd_avg_ev" },
  { ncaaCol: "pitcher_ground_pct", meanKey: "p_ncaa_avg_gb_pct", sdKey: "p_sd_gb_pct" },
  { ncaaCol: "pitcher_in_zone_pct", meanKey: "p_ncaa_avg_in_zone_pct", sdKey: "p_sd_in_zone_pct" },
  { ncaaCol: "pitcher_ev90", meanKey: "p_ncaa_avg_ev90", sdKey: "p_sd_ev90" },
  { ncaaCol: "pitcher_pull_pct", meanKey: "p_ncaa_avg_pull_pct", sdKey: "p_sd_pull_pct" },
  { ncaaCol: "pitcher_la_10_30_pct", meanKey: "p_ncaa_avg_la_10_30_pct", sdKey: "p_sd_la_10_30_pct" },
  // ── Returner hitting means (r_ncaa_avg_*) + SDs (r_*_std_ncaa) ──
  { ncaaCol: "avg", meanKey: "r_ncaa_avg_ba", sdKey: "r_ba_std_ncaa" },
  { ncaaCol: "obp", meanKey: "r_ncaa_avg_obp", sdKey: "r_obp_std_ncaa" },
  // r_iso_std_ncaa: NEW mirror (no current reader consumes it; written for
  // completeness so mean+SD are stored for every metric, per directive).
  { ncaaCol: "iso", meanKey: "r_ncaa_avg_iso", sdKey: "r_iso_std_ncaa" },
  // ── Transfer hitting means (t_*_ncaa_avg) + SDs (t_*_std_ncaa) ──
  { ncaaCol: "avg", meanKey: "t_ba_ncaa_avg", sdKey: "t_ba_std_ncaa" },
  { ncaaCol: "obp", meanKey: "t_obp_ncaa_avg", sdKey: "t_obp_std_ncaa" },
  { ncaaCol: "iso", meanKey: "t_iso_ncaa_avg", sdKey: "t_iso_std_ncaa" },
];

const MODEL_CONFIG_MODEL_TYPE = "admin_ui";

export type ModelConfigRow = {
  model_type: string;
  season: number;
  config_key: string;
  config_value: number;
};

/**
 * Pure helper: derive the model_config rows to upsert from the computed
 * `updates` object (the same object written to `ncaa_averages`). Skips any
 * key whose source value is null/non-finite — `model_config.config_value` is
 * NUMERIC NOT NULL, so nulls (e.g. an unused SD) are omitted rather than
 * written. By reading from the SAME `updates` object, values are guaranteed
 * identical to the `ncaa_averages` row by construction.
 */
export function buildModelConfigRows(
  updates: Record<string, number | null>,
  season: number,
): ModelConfigRow[] {
  const rows: ModelConfigRow[] = [];
  const push = (config_key: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(Number(value))) return;
    rows.push({ model_type: MODEL_CONFIG_MODEL_TYPE, season, config_key, config_value: Number(value) });
  };
  for (const m of MODEL_CONFIG_MEAN_SD_MAP) {
    push(m.meanKey, updates[m.ncaaCol]);
    if (m.sdKey) push(m.sdKey, updates[`${m.ncaaCol}_sd`]);
  }
  return rows;
}

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

/**
 * Deterministic pagination key per table — the table's ACTUAL primary key.
 *
 * ⚠ Do NOT replace these with a blanket `.order("id")`. Verified against both
 * projects' `information_schema.columns` on 2026-08-30: `pitch_log_*_totals` and
 * `player_season_defense`/`player_season_baserunning` have **no `id` column at
 * all**, and a blanket `order("id")` has already broken this class of fix twice
 * today. PKs as probed (identical on staging slrxowawbijbjrkozqlj and prod
 * trbvxuoliwrfowibatkm):
 *   "Hitter Master"             → id
 *   "Pitching Master"           → id
 *   pitcher_stuff_plus_inputs   → id
 *   pitch_log_pitcher_totals    → (pitcher_id, season, dimension_key)
 *   pitch_log_hitter_totals     → (batter_id, season, dimension_key)
 *   player_season_defense       → (player_id, season, position)   [no id]
 *   player_season_baserunning   → (player_id, season)             [no id]
 */
const PAGINATION_KEYS: Record<string, string[]> = {
  "Hitter Master": ["id"],
  "Pitching Master": ["id"],
  pitcher_stuff_plus_inputs: ["id"],
  // season + dimension_key are pinned by the query's own filters, so pitcher_id
  // alone is already unique within a page set — order by all three anyway so the
  // ordering is total regardless of how the caller filters.
  pitch_log_pitcher_totals: ["pitcher_id", "season", "dimension_key"],
  pitch_log_hitter_totals: ["batter_id", "season", "dimension_key"],
  player_season_defense: ["player_id", "season", "position"],
  player_season_baserunning: ["player_id", "season"],
};

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
  /** Extra equality filters (e.g. { dimension_key: "all" }). */
  extraEq: Record<string, string | number> = {},
): Promise<any[]> {
  const PAGE = 1000;
  const orderCols = PAGINATION_KEYS[table];
  if (!orderCols) {
    // Fail loud rather than paginate unordered — an unordered `.range()` silently
    // drops/duplicates rows and corrupts every mean/SD downstream.
    throw new Error(
      `fetchAllRows: no pagination key registered for "${table}". Add its ACTUAL primary key to PAGINATION_KEYS (verify via information_schema.columns — several of these tables have no "id" column).`,
    );
  }
  const all: any[] = [];
  let offset = 0;
  while (true) {
    let q = (supabase as any).from(table).select(select).eq(seasonCol, season);
    if (divisionFilter) q = q.eq("division", divisionFilter);
    for (const [k, v] of Object.entries(extraEq)) q = q.eq(k, v);
    for (const c of orderCols) q = q.order(c, { ascending: true });
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

export async function computeAndStoreNcaaAverages(
  season: number,
  opts: { dryRun?: boolean } = {},
): Promise<{
  hittersUsed: number;
  pitchersUsed: number;
  fieldsWritten: number;
  modelConfigRowsWritten: number;
  modelConfigRows: ModelConfigRow[];
  errors: string[];
}> {
  const { dryRun = false } = opts;
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

  // ─── Stuff+ — weighted by scored pitches per pitcher (LIVE pitch_log lane) ──
  // The Stuff+ VALUE comes from "Pitching Master".stuff_plus, which the pitch_log
  // chain (C25 `derive_masters_from_pitchlog`) writes. The WEIGHT must come from
  // the SAME lane: `pitch_log_pitcher_totals.stuff_plus_data_pitches` at
  // dimension_key='all' (the per-pitcher count of pitches that actually received a
  // Stuff+ score), joined pitcher_id ↔ Pitching Master.source_player_id.
  //
  // ⚠ 2026-08-30 FIX. This previously summed `pitcher_stuff_plus_inputs.pitches` —
  // the LEGACY raw-HB lane this push bans everywhere else. Two failure modes:
  //   • any pitcher present in the pitch_log lane but absent from the legacy table
  //     got weight 0 and was dropped from the mean entirely;
  //   • the fetch was wrapped in `.catch(() => [])`, so a total failure became
  //     "every weight 0" → `stuff_plus` written as NULL → `computeAndStoreScores`
  //     `fetchSeasonBaselines` silently falls back to hardcoded defaults.
  // Measured impact of the lane swap on the 2026 D1 pitch-weighted mean
  // (read-only probe 2026-08-30): staging legacy 102.0846 vs live 102.0846 (no
  // change — the two tables happen to agree there); PROD legacy 101.8361 vs live
  // 102.3337 (+0.4976 — prod's legacy table is stale/JUCO-contaminated). Prod's
  // stored ncaa_averages(2026).stuff_plus = 101.8341, i.e. the legacy value.
  // The `.catch` is REMOVED on purpose: a fetch failure must be loud.
  console.time("[NcaaAvg] 4b. stuff+ weighted by pitches");
  // pitch_log_pitcher_totals has no `division` column — pass null. The join via
  // source_player_id below naturally restricts to D1 pitchers because the outer
  // `pitchers` set is already D1-filtered.
  const pitchTotals = await fetchAllRows(
    "pitch_log_pitcher_totals",
    "pitcher_id, stuff_plus_data_pitches",
    season,
    "season",
    null,
    { dimension_key: "all" },
  );
  const pitchesByPitcher = new Map<string, number>();
  for (const r of pitchTotals) {
    const sid = (r as any).pitcher_id;
    const p = Number((r as any).stuff_plus_data_pitches);
    if (!sid || !Number.isFinite(p) || p <= 0) continue;
    const k = String(sid);
    pitchesByPitcher.set(k, (pitchesByPitcher.get(k) ?? 0) + p);
  }
  const stuffWeighted: Array<{ value: number; weight: number }> = [];
  const stuffQualified: number[] = [];
  for (const r of pitchers) {
    const sid = (r as any).source_player_id;
    const v = (r as any).stuff_plus;
    if (v == null || !Number.isFinite(Number(v))) continue;
    const value = Number(v);
    // pitch_log_pitcher_totals.pitcher_id is TEXT; Master.source_player_id may be
    // numeric — normalise both sides to string before the lookup.
    const w = sid != null ? (pitchesByPitcher.get(String(sid)) ?? 0) : 0;
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

  // Exit velo is a batted-ball property — one number per batted ball, identical
  // whether aggregated by hitter or pitcher. So the NCAA-wide pitcher exit-velo
  // fields are the hitter values 1-for-1 (mean AND sd), not a separate pitcher-
  // side aggregation. (pitcher_in_zone_pct IS pitcher-specific — computed above
  // from Pitching Master.in_zone_pct, which the pitch-log derive populates.)
  updates["pitcher_exit_velo"] = updates["exit_velo"] ?? null;
  updates["pitcher_exit_velo_sd"] = updates["exit_velo_sd"] ?? null;
  updates["pitcher_ev90"] = updates["ev90"] ?? null;
  updates["pitcher_ev90_sd"] = updates["ev90_sd"] ?? null;

  // ─── model_config mirror rows (mean + SD for every mapped metric) ────────
  // Built from the SAME `updates` object → identical values in both stores.
  const modelConfigRows = buildModelConfigRows(updates, season);

  if (dryRun) {
    console.log(`[NcaaAvg] DRY-RUN — no DB writes. Would upsert ncaa_averages (${Object.keys(updates).length - 1} fields) + ${modelConfigRows.length} model_config rows (model_type='${MODEL_CONFIG_MODEL_TYPE}', season=${season}):`);
    for (const r of modelConfigRows) {
      console.log(`[NcaaAvg]   model_config  ${r.config_key} = ${r.config_value}`);
    }
    console.timeEnd("[NcaaAvg] TOTAL");
    return {
      hittersUsed: hitters.length,
      pitchersUsed: pitchers.length,
      fieldsWritten: Object.keys(updates).length - 1, // minus season
      modelConfigRowsWritten: 0,
      modelConfigRows,
      errors,
    };
  }

  // ─── Upsert (ncaa_averages) ─────────────────────────────────────────────
  console.time("[NcaaAvg] 5. upsert ncaa_averages");
  const { error } = await (supabase as any)
    .from("ncaa_averages")
    .upsert([updates], { onConflict: "season" });
  if (error) errors.push(`Upsert ncaa_averages: ${error.message}`);
  console.timeEnd("[NcaaAvg] 5. upsert ncaa_averages");

  // ─── Upsert (model_config mirror) ───────────────────────────────────────
  // Idempotent on the natural key (model_type, season, config_key).
  console.time("[NcaaAvg] 6. upsert model_config");
  let modelConfigRowsWritten = 0;
  if (modelConfigRows.length > 0) {
    const { error: mcError } = await (supabase as any)
      .from("model_config")
      .upsert(modelConfigRows, { onConflict: "model_type,season,config_key" });
    if (mcError) errors.push(`Upsert model_config: ${mcError.message}`);
    else modelConfigRowsWritten = modelConfigRows.length;
  }
  console.timeEnd("[NcaaAvg] 6. upsert model_config");
  console.timeEnd("[NcaaAvg] TOTAL");

  return {
    hittersUsed: hitters.length,
    pitchersUsed: pitchers.length,
    fieldsWritten: Object.keys(updates).length - 1, // minus season
    modelConfigRowsWritten,
    modelConfigRows,
    errors,
  };
}
