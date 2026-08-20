import { supabase } from "@/integrations/supabase/client";
import type { ModelConfigRow } from "@/lib/computeNcaaAverages";

// ─────────────────────────────────────────────────────────────────────────
// std_pr — power-rating standard deviations.
//
// `std_pr` is the SD of a per-player POWER RATING (ba/obp/iso_power_rating for
// hitters, era/fip/whip/k9/bb9/hr9_pr_plus for pitchers). It is the denominator
// of the returner/transfer SD-blend:
//
//   scaled = ncaaAvg + ((Plus − 100) / std_pr) × std_ncaa
//
// After Step 2b (computeAndStoreAllScores) recomputes every rating on the new
// pitch-log Masters, the stored std_pr go stale (the ratings' spread changed).
// This job re-measures the SDs on the CURRENT ratings and stores them so nothing
// runs on a stale denominator. Store-everything: the values land in model_config
// (what the Deno edge fns read) and must match the code defaults.
//
// THRESHOLD RECONCILIATION (documented, deliberate):
//   • Power-rating SDs (THIS job) qualify at PA ≥ 60 (hitters) / IP ≥ 40 (pitchers).
//     This reproduces the provenance of the stored constants — e.g. current
//     obp_power_rating SD @ PA≥60 = 31.895 (matches the ~31.89 reference), and
//     bb9_pr_plus SD @ IP≥40 = 42.917 (matches the stored bb9_pr_sd 42.8949,
//     bb9 being an un-refit metric whose ratings are stable across the recompute).
//   • This is a DIFFERENT convention than computeNcaaAverages' calcQualifiedSd,
//     which qualifies the NCAA-METRIC SDs at AB ≥ 75 / IP ≥ 25. Those are two
//     distinct SD families with two distinct thresholds — intentionally not unified.
//
// D1 only; JUCO excluded (division = 'D1').
// ─────────────────────────────────────────────────────────────────────────

const MODEL_CONFIG_MODEL_TYPE = "admin_ui";
const QUALIFIED_PA = 60; // hitter power-rating SD threshold
const QUALIFIED_IP = 40; // pitcher power-rating SD threshold

// Hitter power-rating column → the model_config keys the readers consume.
// Returner (r_*) and transfer (t_*) share the SAME measured SD (it's the SD of
// the same power rating), so one measurement fills both keys.
//   • r_ba_std_pr / t_ba_std_pr   ← ba_power_rating   (edge fn recalculate-prediction, buildTransferProjectionInputs, TeamBuilder)
//   • r_obp_std_pr / t_obp_std_pr ← obp_power_rating
//   • r_iso_std_power (NEW) / t_iso_std_power ← iso_power_rating
//     (edge fn prefers r_iso_std_power, falls back to t_iso_std_power)
const HITTER_STD_PR: Array<{ col: string; keys: string[] }> = [
  { col: "ba_power_rating", keys: ["r_ba_std_pr", "t_ba_std_pr"] },
  { col: "obp_power_rating", keys: ["r_obp_std_pr", "t_obp_std_pr"] },
  { col: "iso_power_rating", keys: ["r_iso_std_power", "t_iso_std_power"] },
];

// Pitcher pr_plus column → model_config key. NOTE: no runtime reader consumes
// these p_*_pr_sd keys today — the pitcher projection reads era_pr_sd…hr9_pr_sd
// from readPitchingWeights() code defaults (pitchingEquations.ts), not model_config.
// They are stored here for consistency/completeness so the SDs live in one place.
const PITCHER_STD_PR: Array<{ col: string; key: string }> = [
  { col: "era_pr_plus", key: "p_era_pr_sd" },
  { col: "fip_pr_plus", key: "p_fip_pr_sd" },
  { col: "whip_pr_plus", key: "p_whip_pr_sd" },
  { col: "k9_pr_plus", key: "p_k9_pr_sd" },
  { col: "bb9_pr_plus", key: "p_bb9_pr_sd" },
  { col: "hr9_pr_plus", key: "p_hr9_pr_sd" },
];

// Sample SD (Bessel's correction, divide by n-1). Same convention as
// computeNcaaAverages.calcQualifiedSd — only the qualification threshold differs.
function calcSd(values: number[]): number | null {
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
): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(select)
      .eq("Season", season)
      .eq("division", "D1")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// SD of `col` over rows whose weight column ≥ threshold. Round to 5 decimals
// (same precision as computeNcaaAverages SD writes).
function measureSd(rows: any[], col: string, weightCol: string, threshold: number): { sd: number | null; n: number } {
  const vals: number[] = [];
  for (const r of rows) {
    const v = r[col];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const w = Number(r[weightCol]);
    if (Number.isFinite(w) && w >= threshold) vals.push(Number(v));
  }
  const s = calcSd(vals);
  return { sd: s == null ? null : Math.round(s * 100000) / 100000, n: vals.length };
}

/**
 * Measure the power-rating SDs on the CURRENT ratings and upsert them to
 * model_config (model_type='admin_ui', natural key (model_type, season, config_key)).
 * MUST run AFTER computeAndStoreAllScores — it reads the freshly-recomputed
 * *_power_rating / *_pr_plus columns off the Masters.
 *
 * dryRun logs the intended writes without touching the DB (mirrors
 * computeAndStoreNcaaAverages' dry-run contract).
 */
export async function computeAndStoreStdPr(
  season: number,
  opts: { dryRun?: boolean } = {},
): Promise<{
  hittersQualified: Record<string, number>;
  pitchersQualified: Record<string, number>;
  modelConfigRows: ModelConfigRow[];
  modelConfigRowsWritten: number;
  errors: string[];
}> {
  const { dryRun = false } = opts;
  const errors: string[] = [];
  console.time("[StdPr] TOTAL");

  // ── Hitters ──────────────────────────────────────────────────────────
  const hitters = await fetchAllRows(
    "Hitter Master",
    "id, pa, ba_power_rating, obp_power_rating, iso_power_rating",
    season,
  );
  console.log(`[StdPr] ${hitters.length} D1 hitter rows for ${season}`);

  const rows: ModelConfigRow[] = [];
  const push = (config_key: string, value: number | null) => {
    if (value == null || !Number.isFinite(Number(value))) {
      errors.push(`skip ${config_key}: SD null/non-finite`);
      return;
    }
    rows.push({ model_type: MODEL_CONFIG_MODEL_TYPE, season, config_key, config_value: Number(value) });
  };

  const hittersQualified: Record<string, number> = {};
  for (const m of HITTER_STD_PR) {
    const { sd, n } = measureSd(hitters, m.col, "pa", QUALIFIED_PA);
    hittersQualified[m.col] = n;
    console.log(`[StdPr] hitter ${m.col} SD (PA≥${QUALIFIED_PA}, n=${n}) = ${sd}`);
    for (const key of m.keys) push(key, sd);
  }

  // ── Pitchers ─────────────────────────────────────────────────────────
  const pitchers = await fetchAllRows(
    "Pitching Master",
    'id, "IP", era_pr_plus, fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus',
    season,
  );
  console.log(`[StdPr] ${pitchers.length} D1 pitcher rows for ${season}`);

  const pitchersQualified: Record<string, number> = {};
  for (const m of PITCHER_STD_PR) {
    const { sd, n } = measureSd(pitchers, m.col, "IP", QUALIFIED_IP);
    pitchersQualified[m.col] = n;
    console.log(`[StdPr] pitcher ${m.col} SD (IP≥${QUALIFIED_IP}, n=${n}) = ${sd}`);
    push(m.key, sd);
  }

  if (dryRun) {
    console.log(`[StdPr] DRY-RUN — no DB writes. Would upsert ${rows.length} model_config rows (model_type='${MODEL_CONFIG_MODEL_TYPE}', season=${season}):`);
    for (const r of rows) console.log(`[StdPr]   model_config  ${r.config_key} = ${r.config_value}`);
    console.timeEnd("[StdPr] TOTAL");
    return { hittersQualified, pitchersQualified, modelConfigRows: rows, modelConfigRowsWritten: 0, errors };
  }

  let modelConfigRowsWritten = 0;
  if (rows.length > 0) {
    const { error } = await (supabase as any)
      .from("model_config")
      .upsert(rows, { onConflict: "model_type,season,config_key" });
    if (error) errors.push(`Upsert model_config: ${error.message}`);
    else modelConfigRowsWritten = rows.length;
  }
  console.timeEnd("[StdPr] TOTAL");

  return { hittersQualified, pitchersQualified, modelConfigRows: rows, modelConfigRowsWritten, errors };
}
