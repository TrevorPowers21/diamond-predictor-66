#!/usr/bin/env node
/**
 * Verify our xBA / xSLG distributions match actual AVG / SLG distributions
 * in the 2026 D1 hitter population, and same for pitcher xBA-against /
 * xSLG-against vs PM-derived equivalents.
 *
 * If our x-stats are correctly calibrated:
 *   - Population mean xBA  ≈ population mean AVG
 *   - Distribution shape should be similar
 *
 * If they DIVERGE materially, the lookup buckets may be biased.
 *
 * Usage:
 *   npm run verify-xstats-distribution
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const MIN_AB = 50;
const MIN_BF_PITCHER = 50;

async function fetchAllHitters() {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("pitch_log_hitter_totals")
      .select(
        "batter_id, ab, hits_single, hits_double, hits_triple, hits_hr, x_hits_sum, x_bases_sum, x_woba_sum, bb, hbp, sac",
      )
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function fetchAllPitchers() {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("pitch_log_pitcher_totals")
      .select(
        "pitcher_id, total_ab, hits_single_allowed, hits_double_allowed, hits_triple_allowed, hits_hr_allowed, x_hits_sum_allowed, x_bases_sum_allowed",
      )
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`=== Hitter side ===\n`);
  const hitters = await fetchAllHitters();
  console.log(`Loaded ${hitters.length} hitter rows.`);

  const qHitters = hitters.filter((r) => r.ab >= MIN_AB);
  console.log(`${qHitters.length} hitters with AB >= ${MIN_AB}.\n`);

  const actualAvg: number[] = [];
  const xba: number[] = [];
  const actualSlg: number[] = [];
  const xslg: number[] = [];
  let totalAb = 0,
    totalHits = 0,
    totalXHits = 0,
    totalTB = 0,
    totalXBases = 0;

  for (const r of qHitters) {
    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const tb = r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr;
    actualAvg.push(hits / r.ab);
    if (r.x_hits_sum != null) xba.push(r.x_hits_sum / r.ab);
    actualSlg.push(tb / r.ab);
    if (r.x_bases_sum != null) xslg.push(r.x_bases_sum / r.ab);
    totalAb += r.ab;
    totalHits += hits;
    totalTB += tb;
    if (r.x_hits_sum != null) totalXHits += r.x_hits_sum;
    if (r.x_bases_sum != null) totalXBases += r.x_bases_sum;
  }

  console.log("League-wide totals:");
  console.log(`  AVG  league = ${(totalHits / totalAb).toFixed(3)}`);
  console.log(`  xBA  league = ${(totalXHits / totalAb).toFixed(3)}`);
  console.log(`  SLG  league = ${(totalTB / totalAb).toFixed(3)}`);
  console.log(`  xSLG league = ${(totalXBases / totalAb).toFixed(3)}\n`);

  console.log("Distribution percentiles:");
  const pcts = [10, 25, 50, 75, 90];
  for (const p of pcts) {
    console.log(
      `  p${p.toString().padStart(2)}: AVG=${percentile(actualAvg, p).toFixed(3)} / xBA=${percentile(xba, p).toFixed(3)} | SLG=${percentile(actualSlg, p).toFixed(3)} / xSLG=${percentile(xslg, p).toFixed(3)}`,
    );
  }

  console.log(`\n=== Pitcher side ===\n`);
  const pitchers = await fetchAllPitchers();
  console.log(`Loaded ${pitchers.length} pitcher rows.`);
  const qPitchers = pitchers.filter((r) => r.total_ab >= MIN_BF_PITCHER);
  console.log(`${qPitchers.length} pitchers with AB >= ${MIN_BF_PITCHER}.\n`);

  const actualBaa: number[] = [];
  const xbaAgainst: number[] = [];
  const actualSlgAgainst: number[] = [];
  const xslgAgainst: number[] = [];
  let pAb = 0,
    pHits = 0,
    pXHits = 0,
    pTb = 0,
    pXBases = 0;

  for (const r of qPitchers) {
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
    actualBaa.push(hits / r.total_ab);
    if (r.x_hits_sum_allowed != null) xbaAgainst.push(r.x_hits_sum_allowed / r.total_ab);
    actualSlgAgainst.push(tb / r.total_ab);
    if (r.x_bases_sum_allowed != null)
      xslgAgainst.push(r.x_bases_sum_allowed / r.total_ab);
    pAb += r.total_ab;
    pHits += hits;
    pTb += tb;
    if (r.x_hits_sum_allowed != null) pXHits += r.x_hits_sum_allowed;
    if (r.x_bases_sum_allowed != null) pXBases += r.x_bases_sum_allowed;
  }

  console.log("League-wide pitcher totals:");
  console.log(`  BAA  league = ${(pHits / pAb).toFixed(3)}`);
  console.log(`  xBA  against league = ${(pXHits / pAb).toFixed(3)}`);
  console.log(`  SLG-against league  = ${(pTb / pAb).toFixed(3)}`);
  console.log(`  xSLG against league = ${(pXBases / pAb).toFixed(3)}\n`);

  console.log("Pitcher distribution percentiles:");
  for (const p of pcts) {
    console.log(
      `  p${p.toString().padStart(2)}: BAA=${percentile(actualBaa, p).toFixed(3)} / xBA=${percentile(xbaAgainst, p).toFixed(3)} | SLG-a=${percentile(actualSlgAgainst, p).toFixed(3)} / xSLG=${percentile(xslgAgainst, p).toFixed(3)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
