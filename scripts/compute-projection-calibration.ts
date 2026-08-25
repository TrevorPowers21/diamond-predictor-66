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

async function pageAll(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    // .order() REQUIRED — range() without a stable sort silently skips rows.
    const { data, error } = await (sb as any).from(table).select(cols).eq("Season", SEASON).order("source_player_id").range(from, from + page - 1);
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
  // hitters (symmetric — two-sided ≈ single, but keep it consistent + data-fresh)
  { key: "r_ba_std", table: "Hitter Master", statCol: "AVG", qualCol: "pa", qualMin: 100, lowerBetter: false },
  { key: "r_obp_std", table: "Hitter Master", statCol: "OBP", qualCol: "pa", qualMin: 100, lowerBetter: false },
  { key: "t_iso_std", table: "Hitter Master", statCol: "ISO", qualCol: "pa", qualMin: 100, lowerBetter: false },
];

async function main() {
  console.log(`DB=${host} season=${SEASON} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const cache: Record<string, any[]> = {};
  const rows: { model_type: string; season: number; config_key: string; config_value: string }[] = [];

  for (const s of STATS) {
    if (!cache[s.table]) {
      const cols = s.table === "Pitching Master" ? "ERA,FIP,WHIP,K9,BB9,HR9,IP" : "AVG,OBP,SLG,ISO,pa";
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
