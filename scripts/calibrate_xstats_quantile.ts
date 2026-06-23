#!/usr/bin/env node
/**
 * Quantile-map xBA / xSLG / xwOBA / xBA-against / xSLG-against on both
 * hitter and pitcher sides. Produces TS lookup arrays for direct paste
 * into src/savant/lib/pitchLogRates.ts.
 *
 * Approach: pair raw_xstat with actual_stat for every qualified player,
 * sort each list independently, output 51-point [raw_xstat, mapped_actual]
 * tuples. Same pattern as calibrate_xera_quantile.
 *
 * Usage:
 *   npm run calibrate-xstats-quantile
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const MIN_AB_HITTER = 50;
const MIN_AB_PITCHER = 50;
const N_POINTS = 51;

const W_BB = 0.696;
const W_HBP = 0.726;

async function fetchAll<T>(
  table: string,
  cols: string,
  dim: string = "all",
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(cols)
      .eq("season", SEASON)
      .eq("dimension_key", dim)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function buildLookup(pairs: Array<{ x: number; y: number }>): Array<[number, number]> {
  const xs = [...pairs].sort((a, b) => a.x - b.x).map((p) => p.x);
  const ys = [...pairs].sort((a, b) => a.y - b.y).map((p) => p.y);
  const lookup: Array<[number, number]> = [];
  for (let i = 0; i < N_POINTS; i++) {
    const idx = Math.floor((i / (N_POINTS - 1)) * (pairs.length - 1));
    lookup.push([xs[idx], ys[idx]]);
  }
  return lookup;
}

function printLookup(name: string, lookup: Array<[number, number]>) {
  console.log(`\nconst ${name}: ReadonlyArray<readonly [number, number]> = [`);
  for (const [x, y] of lookup) {
    console.log(`  [${x.toFixed(4)}, ${y.toFixed(4)}],`);
  }
  console.log("];");
}

async function main() {
  // ── HITTER side ───────────────────────────────────────────────────
  console.log("=== HITTER side ===\n");
  const hitters: any[] = await fetchAll(
    "pitch_log_hitter_totals",
    "batter_id, ab, hits_single, hits_double, hits_triple, hits_hr, x_hits_sum, x_bases_sum, x_woba_sum, bb, hbp, sac",
  );
  const qH = hitters.filter((r) => r.ab >= MIN_AB_HITTER && r.x_hits_sum != null);
  console.log(`Qualified hitters (AB >= ${MIN_AB_HITTER}): ${qH.length}\n`);

  const hAvg: Array<{ x: number; y: number }> = [];
  const hSlg: Array<{ x: number; y: number }> = [];
  const hWoba: Array<{ x: number; y: number }> = [];

  for (const r of qH) {
    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const tb = r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr;
    hAvg.push({ x: r.x_hits_sum / r.ab, y: hits / r.ab });
    hSlg.push({ x: r.x_bases_sum / r.ab, y: tb / r.ab });
    // wOBA: (sum_woba + W_BB*BB + W_HBP*HBP) / (AB + BB + HBP + SF)
    const obpDen = r.ab + r.bb + r.hbp + r.sac;
    const wobaActualNum =
      0.882 * r.hits_single +
      1.254 * r.hits_double +
      1.586 * r.hits_triple +
      2.041 * r.hits_hr +
      W_BB * r.bb +
      W_HBP * r.hbp;
    const wobaXNum = r.x_woba_sum + W_BB * r.bb + W_HBP * r.hbp;
    if (obpDen > 0) {
      hWoba.push({ x: wobaXNum / obpDen, y: wobaActualNum / obpDen });
    }
  }

  printLookup("HITTER_XBA_LOOKUP", buildLookup(hAvg));
  printLookup("HITTER_XSLG_LOOKUP", buildLookup(hSlg));
  printLookup("HITTER_XWOBA_LOOKUP", buildLookup(hWoba));

  // ── PITCHER side ──────────────────────────────────────────────────
  console.log("\n\n=== PITCHER side ===\n");
  const pitchers: any[] = await fetchAll(
    "pitch_log_pitcher_totals",
    "pitcher_id, total_ab, hits_single_allowed, hits_double_allowed, hits_triple_allowed, hits_hr_allowed, x_hits_sum_allowed, x_bases_sum_allowed",
  );
  const qP = pitchers.filter(
    (r) => r.total_ab >= MIN_AB_PITCHER && r.x_hits_sum_allowed != null,
  );
  console.log(`Qualified pitchers (AB >= ${MIN_AB_PITCHER}): ${qP.length}\n`);

  const pBaa: Array<{ x: number; y: number }> = [];
  const pSlg: Array<{ x: number; y: number }> = [];

  for (const r of qP) {
    const hits =
      r.hits_single_allowed +
      r.hits_double_allowed +
      r.hits_triple_allowed +
      r.hits_hr_allowed;
    const tb =
      r.hits_single_allowed +
      2 * r.hits_double_allowed +
      3 * r.hits_triple_allowed +
      4 * r.hits_hr_allowed;
    pBaa.push({ x: r.x_hits_sum_allowed / r.total_ab, y: hits / r.total_ab });
    pSlg.push({ x: r.x_bases_sum_allowed / r.total_ab, y: tb / r.total_ab });
  }

  printLookup("PITCHER_XBA_LOOKUP", buildLookup(pBaa));
  printLookup("PITCHER_XSLG_LOOKUP", buildLookup(pSlg));

  // Spot-checks
  const aaron = qH.find((r) => r.batter_id === "1750930555");
  const roblez = qP.find((r) => r.pitcher_id === "1180787200");
  console.log("\n\n=== Spot-checks ===");
  if (aaron) {
    const hits = aaron.hits_single + aaron.hits_double + aaron.hits_triple + aaron.hits_hr;
    const tb = aaron.hits_single + 2 * aaron.hits_double + 3 * aaron.hits_triple + 4 * aaron.hits_hr;
    console.log(
      `Piasecki: actual AVG=${(hits / aaron.ab).toFixed(3)}, raw xBA=${(aaron.x_hits_sum / aaron.ab).toFixed(3)}; actual SLG=${(tb / aaron.ab).toFixed(3)}, raw xSLG=${(aaron.x_bases_sum / aaron.ab).toFixed(3)}`,
    );
  }
  if (roblez) {
    const hits =
      roblez.hits_single_allowed +
      roblez.hits_double_allowed +
      roblez.hits_triple_allowed +
      roblez.hits_hr_allowed;
    const tb =
      roblez.hits_single_allowed +
      2 * roblez.hits_double_allowed +
      3 * roblez.hits_triple_allowed +
      4 * roblez.hits_hr_allowed;
    console.log(
      `Roblez: actual BAA=${(hits / roblez.total_ab).toFixed(3)}, raw xBA=${(roblez.x_hits_sum_allowed / roblez.total_ab).toFixed(3)}; actual SLG-a=${(tb / roblez.total_ab).toFixed(3)}, raw xSLG=${(roblez.x_bases_sum_allowed / roblez.total_ab).toFixed(3)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
