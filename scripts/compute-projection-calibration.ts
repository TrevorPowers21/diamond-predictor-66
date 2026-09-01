/**
 * Pipeline STAGE 5.5 — Projection calibration (two-sided SD + HR9 sample-size shrinkage).
 * Full design: docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md
 *
 * The z-shift projection map assumed (a) correlation=1 and (b) a symmetric stat. Pitching rates are
 * right-skewed → one symmetric SD (inflated by the bad tail) over-projects the compressed good side
 * (impossible negative HR9, elite ERA 1.13). Fix, all data-derived — no floors, no dials:
 *   1. QUALIFIED population (IP≥40 / PA≥100).
 *   2. TWO-SIDED SD: sd_good = RMS of deviations BETTER than the mean, sd_bad = RMS of those WORSE.
 *      Projection uses sd_good toward elite, sd_bad toward poor.
 *   3. HR9 ONLY — sample-size shrinkage (it's the sole luck-dominated stat, luck SD > talent SD):
 *      regressed = mean + (obs − mean)·IP/(IP+K), with K from the variance decomposition
 *      (luck var ∝ C/IP; K = C / talent_var). Baked into HR9's stored mean + two-sided SD.
 *
 * Writes per-stat to model_config: `<key>_ncaa_avg` (calibrated mean), `<key>_ncaa_sd` (good),
 * `<key>_ncaa_sd_bad` (bad). Stage 6 (projectPitchingRate / hitter blend) reads them. Idempotent.
 * Dry-run by default; --apply to write. Edge fn re-derives these each season.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/compute-projection-calibration.ts            # dry-run
 *   npx tsx --env-file-if-exists=.env.local scripts/compute-projection-calibration.ts --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SEASON = 2026;
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const host = (process.env.SUPABASE_URL || "").replace(/https:\/\//, "").split(".")[0];
const num = (v: any): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * 🛑 D1 ONLY — NON-NEGOTIABLE (Trevor, 2026-09-01: *"Yes 100000% needs to only be a d1 baseline.
 *    That is not up for debate one bit. It also needs to reflect the same thing for all other stats."*)
 *
 * ★ THE BUG THIS FIXES. Until 2026-09-01 this function filtered ONLY on Season, so the "NCAA"
 *   baselines every projection centers on were computed across EVERY division. Measured on prod at
 *   the producer's own qualifier (Season 2026, IP >= 40):
 *       D1        1,295 pitchers   mean ERA 5.264
 *       NJCAA_D1    477            mean ERA 6.118   ← 27% of the sample
 *       D2             1                    3.480
 *       ALL       1,773            mean ERA 5.492  → this is what shipped (model_config 5.483215)
 *   ⇒ 477 JUCO pitchers inflated the D1 ERA anchor by **0.229 (4.3%)**, and because the anchor is a
 *     CONSTANT in `powerAdjusted = ncaaAvg ∓ zShift`, every D1 pitcher's projection was shifted by
 *     the same proportion — which is exactly the symptom: ERAs ~4% low at EVERY percentile and in
 *     EVERY class bucket, with no per-class pattern.
 *
 * ⛔ Do NOT remove this filter to "get a bigger sample". A bigger sample of the wrong population is
 *    worse than a smaller sample of the right one. JUCO rates AGAINST these baselines
 *    ([[feedback_juco_uses_d1_baselines]]), so including JUCO here made the contamination circular.
 * ⚠ JUCO's own calibration is a separate, deferred problem — see [[project_juco_restructure_planned]].
 *    Do not try to solve it in this script.
 */
const CALIBRATION_DIVISION = "D1";

async function pageAll(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    // .order() REQUIRED — range() without a stable sort silently skips rows.
    const { data, error } = await (sb as any).from(table).select(cols).eq("Season", SEASON).eq("division", CALIBRATION_DIVISION).order("source_player_id").range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

/** two-sided (split) semi-deviation about the mean */
function twoSided(vals: number[]): { mean: number; sdGood: number; sdBad: number; sdFull: number } {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const lo = vals.filter((v) => v < mean);
  const hi = vals.filter((v) => v >= mean);
  const sdLo = Math.sqrt(lo.reduce((a, v) => a + (v - mean) ** 2, 0) / lo.length);
  const sdHi = Math.sqrt(hi.reduce((a, v) => a + (v - mean) ** 2, 0) / hi.length);
  const sdFull = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  return { mean, sdGood: NaN, sdBad: NaN, sdFull } as any; // filled below per direction
}

/**
 * Data-derived shrinkage K for a per-9 (or per-inning) rate. Luck variance ∝ C/IP
 * (Poisson counts: C = 9·mean for per-9 rates, C = mean for WHIP). talent_var = obs_var − mean_luck_var.
 * K = C / talent_var = the IP where reliability IP/(IP+K) = 0.5.
 */
function deriveK(vals: number[], ips: number[], perNine: boolean): number {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const obsVar = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
  const C = perNine ? 9 * mean : mean;
  const meanLuckVar = ips.reduce((a, ip) => a + C / ip, 0) / ips.length;
  const talentVar = Math.max(1e-9, obsVar - meanLuckVar);
  return C / talentVar;
}

type StatDef = {
  key: string; // model_config key prefix, e.g. "hr9_plus"
  table: "Pitching Master" | "Hitter Master";
  statCol: string;
  qualCol: string;
  qualMin: number;
  lowerBetter: boolean;
  shrink?: boolean; // HR9 only
  perNine?: boolean;
  deriveFromCols?: (r: any) => number | null; // ISO = SLG - AVG
};

const STATS: StatDef[] = [
  { key: "era_plus", table: "Pitching Master", statCol: "ERA", qualCol: "IP", qualMin: 40, lowerBetter: true },
  { key: "fip_plus", table: "Pitching Master", statCol: "FIP", qualCol: "IP", qualMin: 40, lowerBetter: true },
  { key: "whip_plus", table: "Pitching Master", statCol: "WHIP", qualCol: "IP", qualMin: 40, lowerBetter: true },
  { key: "k9_plus", table: "Pitching Master", statCol: "K9", qualCol: "IP", qualMin: 40, lowerBetter: false, perNine: true },
  { key: "bb9_plus", table: "Pitching Master", statCol: "BB9", qualCol: "IP", qualMin: 40, lowerBetter: true, perNine: true },
  { key: "hr9_plus", table: "Pitching Master", statCol: "HR9", qualCol: "IP", qualMin: 40, lowerBetter: true, shrink: true, perNine: true },
  // NOTE: hitters (AVG/OBP/ISO) are symmetric (sd_good ≈ sd_bad) and currently well-calibrated;
  // they use a different model_config key convention (r_ncaa_avg_ba / r_ba_std_ncaa / r_ba_std_pr).
  // Deferred to a clean follow-on — writing their good-SD here would need the hitter directional
  // code landed in lockstep or it would use sd_good symmetrically. Pitching-only for this build.
];

/**
 * 🛑 RATING CENTERS — `<key>_pr_center` and `<key>_pr_sd` (added 2026-09-01)
 *
 * WHY. Every projection does `zShift = ((PR+ − 100) / pr_sd) × ncaa_sd`. That hardcoded **100**
 * assumes the rating is centered on the SAME population the anchor is computed on. It is not.
 * Measured on prod (Season 2026):
 *
 *   PITCHING, D1 + IP>=40 — the population the anchors now use:
 *     era 109.7253 · fip 108.2875 · whip 108.4028 · k9 101.6919 · bb9 **123.1615** · hr9 102.0359
 *     overall_pr_plus 109.0064
 *   …but on the ALL-DIVISION, IP>=20 population those same centers are 96.3–104.0 — i.e. ~100.
 *   ⇒ PR+ was FIT on all-division/IP>=20 and APPLIED to D1/IP>=40. Every qualified D1 pitcher
 *     therefore carried a free head start: for ERA that is ((109.73−100)/27.90)×1.425 = **+0.44 ERA**
 *     of phantom improvement, which is precisely the "ERAs run ~4% low at every percentile, in every
 *     class bucket, with no per-class pattern" symptom.
 *   ★ BB9 is the extreme: center 123.16 where the code assumes 100.
 *
 * HITTING is NOT contaminated the same way — its anchors were already D1-scoped (from the
 * 2026-08-11 refits, not this script) and its centers sit at 100.31–103.79. The residual is real but
 * an order of magnitude smaller. Trevor, 2026-09-01: *"we need to add all of these into the model
 * config to store since apparently they won't settle at 100 and it needs to be consistent and stored
 * off the data runs."* ⇒ emit BOTH sides, so nothing depends on an assumed 100 anywhere.
 *
 * ⚠ `overall_*` is emitted because **transfer projections read it** (Trevor: *"Overall power rating
 *   isn't used except in transfer projections"*). Leaving it on an assumed 100 would leave the
 *   transfer path carrying the same phantom the returner path is having removed.
 * ⛔ These are STORED FROM THE DATA on every run — do not hardcode them back into `src/lib`. That is
 *    how `era_pr_sd` came to differ between src/lib (28.11694) and the edge fn (29.48780404).
 */
type CenterDef = { key: string; table: "Pitching Master" | "Hitter Master"; ratingCol: string; qualCol: string; qualMin: number };
/**
 * 🛑 KEY NAMING — SETTLED 2026-09-01. Match the EXISTING families; do not invent a third pattern.
 *
 *   `p_…`  PITCHING-domain constant. 54 already exist in model_config on BOTH databases
 *          (`p_era_pr_sd`, `p_era_stuff_plus_weight`, …) and `loadPitchingPowerEq`
 *          (`predictionEngine.ts:694`) consumes **only** keys starting `p_`.
 *   `h_…`  HITTING-domain rating constant. NEW, symmetric with `p_`.
 *   `r_…`  returner hitter equation (`r_w_obp`, `r_obp_std_ncaa`)
 *   `t_…`  transfer hitter equation (`t_ba_ncaa_avg`, `t_obp_park_weight`)
 *   `<stat>_plus_…`  per-stat CALIBRATION of the stat itself (`era_plus_ncaa_avg`, `_ncaa_sd`,
 *                    `_ncaa_sd_bad`) — the stat's mean/SD, NOT the rating's.
 *
 * ⇒ A rating CENTER is `p_<stat>_pr_center` / `h_<stat>_pr_center`, sitting directly beside the
 *   `p_<stat>_pr_sd` that already exists. `pr` = power rating; `center`/`sd` describe the rating's
 *   own distribution, which is what the z-shift measures FROM.
 *
 * ⛔ Writing a key here is NOT enough. It only reaches the app if it is ALSO listed in the `fields`
 *    mapping in `pitchingEquations.ts`. That is exactly why the first version of these keys
 *    (`era_plus_pr_center`) was inert: written, never read, matching no reader's filter.
 */
const CENTERS: CenterDef[] = [
  { key: "p_era",  table: "Pitching Master", ratingCol: "era_pr_plus",  qualCol: "IP", qualMin: 40 },
  { key: "p_fip",  table: "Pitching Master", ratingCol: "fip_pr_plus",  qualCol: "IP", qualMin: 40 },
  { key: "p_whip", table: "Pitching Master", ratingCol: "whip_pr_plus", qualCol: "IP", qualMin: 40 },
  { key: "p_k9",   table: "Pitching Master", ratingCol: "k9_pr_plus",   qualCol: "IP", qualMin: 40 },
  { key: "p_bb9",  table: "Pitching Master", ratingCol: "bb9_pr_plus",  qualCol: "IP", qualMin: 40 },
  { key: "p_hr9",  table: "Pitching Master", ratingCol: "hr9_pr_plus",  qualCol: "IP", qualMin: 40 },
  { key: "p_overall", table: "Pitching Master", ratingCol: "overall_pr_plus", qualCol: "IP", qualMin: 40 },
  { key: "h_ba",  table: "Hitter Master", ratingCol: "ba_power_rating",      qualCol: "pa", qualMin: 100 },
  { key: "h_obp", table: "Hitter Master", ratingCol: "obp_power_rating",     qualCol: "pa", qualMin: 100 },
  { key: "h_iso", table: "Hitter Master", ratingCol: "iso_power_rating",     qualCol: "pa", qualMin: 100 },
  { key: "h_overall", table: "Hitter Master", ratingCol: "overall_power_rating", qualCol: "pa", qualMin: 100 },
];

async function main() {
  console.log(`DB=${host} season=${SEASON} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const cache: Record<string, any[]> = {};
  const rows: { model_type: string; season: number; config_key: string; config_value: string }[] = [];

  for (const s of STATS) {
    if (!cache[s.table]) {
      const cols = s.table === "Pitching Master" ? "ERA,FIP,WHIP,K9,BB9,HR9,IP,division" : "AVG,OBP,SLG,ISO,pa,division";
      cache[s.table] = await pageAll(s.table, cols);
    }
    const raw = cache[s.table].filter(
      (r) => num(r[s.statCol]) != null && num(r[s.qualCol]) != null && Number(r[s.qualCol]) >= s.qualMin,
    );
    let vals = raw.map((r) => num(r[s.statCol])!);
    const ips = raw.map((r) => num(r[s.qualCol])!);
    let kNote = "";
    if (s.shrink) {
      const K = deriveK(vals, ips, !!s.perNine);
      const m0 = vals.reduce((a, b) => a + b, 0) / vals.length;
      vals = raw.map((r) => {
        const ip = num(r[s.qualCol])!;
        return m0 + (num(r[s.statCol])! - m0) * (ip / (ip + K));
      });
      kNote = ` [shrink K=${K.toFixed(0)}]`;
      rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${s.key}_shrink_k`, config_value: K.toFixed(4) });
    }
    const t = twoSided(vals);
    const good = s.lowerBetter ? tsLo(vals, t.mean) : tsHi(vals, t.mean);
    const bad = s.lowerBetter ? tsHi(vals, t.mean) : tsLo(vals, t.mean);
    rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${s.key}_ncaa_avg`, config_value: t.mean.toFixed(6) });
    rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${s.key}_ncaa_sd`, config_value: good.toFixed(6) });
    rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${s.key}_ncaa_sd_bad`, config_value: bad.toFixed(6) });
    const f = (x: number) => (Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(2));
    console.log(`  ${s.key.padEnd(10)} n=${String(raw.length).padStart(4)} mean=${f(t.mean)} sd_good=${f(good)} sd_bad=${f(bad)} (full ${f(t.sdFull)})${kNote}`);
  }

  // ── rating centers ────────────────────────────────────────────────────────────────────────────
  for (const cd of CENTERS) {
    const cacheKey = `${cd.table}::${cd.ratingCol}`;
    if (!cache[cacheKey]) cache[cacheKey] = await pageAll(cd.table, `${cd.ratingCol},${cd.qualCol},division`);
    const vals = cache[cacheKey]
      .filter((r) => num(r[cd.ratingCol]) != null && num(r[cd.qualCol]) != null && Number(r[cd.qualCol]) >= cd.qualMin)
      .map((r) => num(r[cd.ratingCol])!);
    if (vals.length === 0) { console.log(`  ${cd.key}_pr_center  SKIPPED — no rows`); continue; }
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / vals.length);
    rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${cd.key}_pr_center`, config_value: mu.toFixed(6) });
    rows.push({ model_type: "admin_ui", season: SEASON, config_key: `${cd.key}_pr_sd`, config_value: sd.toFixed(6) });
    const drift = Math.abs(mu - 100) > 5 ? "   ⚠ far from 100" : "";
    console.log(`  ${cd.key}_pr_center`.padEnd(26) + `n=${String(vals.length).padEnd(6)} center=${mu.toFixed(4).padEnd(10)} sd=${sd.toFixed(4)}${drift}`);
  }

  console.log(`\nmodel_config rows to upsert: ${rows.length}`);
  if (!APPLY) { console.log("DRY-RUN — no writes. Re-run with --apply."); return; }
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await (sb as any).from("model_config").upsert(rows.slice(i, i + 100), { onConflict: "model_type,season,config_key" });
    if (error) { console.log("UPSERT ERR", error.message); process.exit(1); }
  }
  console.log(`APPLIED: upserted ${rows.length} calibration keys to model_config.`);
}

function tsLo(vals: number[], mean: number): number { const lo = vals.filter((v) => v < mean); return Math.sqrt(lo.reduce((a, v) => a + (v - mean) ** 2, 0) / lo.length); }
function tsHi(vals: number[], mean: number): number { const hi = vals.filter((v) => v >= mean); return Math.sqrt(hi.reduce((a, v) => a + (v - mean) ** 2, 0) / hi.length); }

main().catch((e) => { console.error(e); process.exit(1); });
