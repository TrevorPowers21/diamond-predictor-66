#!/usr/bin/env node
/**
 * Calibrate xERA via quantile mapping.
 *
 * For every pitcher in the 2026 population (no IP floor — full pop):
 *   1. Compute xwOBA-against from pitch_log_pitcher_totals
 *   2. Pull actual ERA from Pitching Master
 *   3. Sort both lists independently
 *   4. Build a percentile-mapped lookup: for each xwOBA percentile, output
 *      the corresponding ERA at that same percentile (IP-weighted)
 *
 * Result: piecewise mapping array that derives xERA from a pitcher's
 * xwOBA percentile. Stored as a constant in src/savant/lib/pitchLogRates.ts.
 *
 * Usage:
 *   npm run calibrate-xera-quantile
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const MIN_BF = 30; // very loose floor so we still capture meaningful pitchers

const W_BB = 0.696;
const W_HBP = 0.726;

interface Pair {
  pitcher_id: string;
  xwoba: number;
  era: number;
  ip: number;
}

async function fetchAllPitcherRows(): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("pitch_log_pitcher_totals")
      .select(
        "pitcher_id, total_ab, total_bb, total_hbp, x_woba_sum_allowed, total_bf",
      )
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .range(from, from + 999);
    if (error) {
      console.error(error);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  console.log(`Calibrating xERA via quantile mapping, season ${SEASON}\n`);

  const plRows = await fetchAllPitcherRows();
  console.log(`pitch_log_pitcher_totals: ${plRows.length} rows`);

  const pitcherIds = plRows.map((r) => r.pitcher_id);
  const eraByPitcher = new Map<string, { era: number; ip: number }>();
  for (let i = 0; i < pitcherIds.length; i += 200) {
    const chunk = pitcherIds.slice(i, i + 200);
    const { data, error } = await (supabase as any)
      .from("Pitching Master")
      .select("source_player_id, ERA, IP")
      .eq("Season", SEASON)
      .in("source_player_id", chunk);
    if (error) {
      console.error(error);
      break;
    }
    for (const row of data ?? []) {
      if (row.ERA != null && row.IP != null) {
        eraByPitcher.set(row.source_player_id, { era: row.ERA, ip: row.IP });
      }
    }
  }
  console.log(`Pitching Master ERA join: ${eraByPitcher.size} pitchers\n`);

  const pairs: Pair[] = [];
  for (const r of plRows) {
    if (r.total_bf < MIN_BF) continue;
    const pm = eraByPitcher.get(r.pitcher_id);
    if (!pm) continue;
    if (r.x_woba_sum_allowed == null) continue;
    const num = r.x_woba_sum_allowed + W_BB * r.total_bb + W_HBP * r.total_hbp;
    const den = r.total_ab + r.total_bb + r.total_hbp;
    if (den <= 0) continue;
    pairs.push({ pitcher_id: r.pitcher_id, xwoba: num / den, era: pm.era, ip: pm.ip });
  }
  console.log(`Paired ${pairs.length} pitchers for quantile mapping.\n`);

  // ── Build quantile lookup ────────────────────────────────────────
  // Sort both lists. Same length, so rank i in xwoba list maps to rank i
  // in era list. That's the quantile mapping.
  const sortedXwoba = [...pairs].sort((a, b) => a.xwoba - b.xwoba).map((p) => p.xwoba);
  const sortedEra = [...pairs].sort((a, b) => a.era - b.era).map((p) => p.era);

  // Print mapping at key percentiles
  console.log("=== Quantile mapping (xwOBA percentile → ERA at same percentile) ===");
  const pctsToShow = [1, 5, 10, 25, 50, 75, 90, 95, 99];
  for (const p of pctsToShow) {
    const idx = Math.floor((p / 100) * (pairs.length - 1));
    console.log(`  p${p.toString().padStart(2)}: xwOBA=${sortedXwoba[idx].toFixed(3)} → ERA=${sortedEra[idx].toFixed(2)}`);
  }

  // ── Spot-check Roblez ────────────────────────────────────────────
  const roblez = pairs.find((p) => p.pitcher_id === "1180787200");
  if (roblez) {
    const rankXwoba = sortedXwoba.findIndex((x) => x >= roblez.xwoba);
    const pct = (rankXwoba / pairs.length) * 100;
    const xeraQuantile = sortedEra[rankXwoba];
    console.log(`\nRoblez:`);
    console.log(`  xwOBA = ${roblez.xwoba.toFixed(3)} (p${pct.toFixed(1)})`);
    console.log(`  Quantile-mapped xERA = ${xeraQuantile.toFixed(2)}`);
    console.log(`  Actual ERA = ${roblez.era.toFixed(2)}`);
  }

  // ── Export the lookup as a TS array of (xwoba, era) tuples ──────
  // Take ~50 sample points so the lookup is compact but high-resolution.
  const N_POINTS = 51;
  const lookup: Array<[number, number]> = [];
  for (let i = 0; i < N_POINTS; i++) {
    const idx = Math.floor((i / (N_POINTS - 1)) * (pairs.length - 1));
    lookup.push([sortedXwoba[idx], sortedEra[idx]]);
  }
  console.log(`\n=== Lookup table for pitchLogRates.ts (${lookup.length} points) ===`);
  console.log("const XERA_QUANTILE_LOOKUP: Array<[number, number]> = [");
  for (const [x, e] of lookup) {
    console.log(`  [${x.toFixed(4)}, ${e.toFixed(2)}],`);
  }
  console.log("];");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
