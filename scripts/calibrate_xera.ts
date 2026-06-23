#!/usr/bin/env node
/**
 * Calibrate the xERA conversion constants by regressing xwOBA-against
 * (derived from pitch_log_pitcher_totals.x_woba_sum_allowed) on actual
 * ERA (from Pitching Master) for qualified D1 pitchers.
 *
 * Outputs the three constants to wire into pitchLogRates.ts:
 *   - COLLEGE_LEAGUE_AVG_XWOBA  (intercept anchor)
 *   - COLLEGE_LEAGUE_AVG_ERA    (intercept anchor)
 *   - XERA_SLOPE                (ΔERA per Δ1.0 xwOBA — typically ~10-15)
 *
 * Usage:
 *   npm run calibrate-xera
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const MIN_IP = 20;

const W_BB = 0.696;
const W_HBP = 0.726;

async function main() {
  console.log(`Calibrating xERA from xwOBA-against, season ${SEASON}, min IP ${MIN_IP}\n`);

  // 1. Fetch qualified pitcher rows from pitch_log_pitcher_totals 'all' dim
  const plRows: any[] = [];
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
    plRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Fetched ${plRows.length} pitcher rows from pitch_log_pitcher_totals.`);

  // 2. Fetch ERA from Pitching Master for the same pitchers
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
  console.log(`Joined ERA for ${eraByPitcher.size} pitchers in Pitching Master.\n`);

  // 3. Compute xwOBA for each pitcher and pair with ERA
  const points: Array<{ xwoba: number; era: number; ip: number }> = [];
  for (const r of plRows) {
    const pm = eraByPitcher.get(r.pitcher_id);
    if (!pm || pm.ip < MIN_IP) continue;
    if (r.x_woba_sum_allowed == null) continue;
    const num = r.x_woba_sum_allowed + W_BB * r.total_bb + W_HBP * r.total_hbp;
    const den = r.total_ab + r.total_bb + r.total_hbp;
    if (den <= 0) continue;
    const xwoba = num / den;
    points.push({ xwoba, era: pm.era, ip: pm.ip });
  }
  console.log(`${points.length} qualified pitchers for regression.\n`);

  if (points.length < 30) {
    console.error("Too few qualified pitchers — need at least 30. Aborting.");
    return;
  }

  // 4. Weighted linear regression: ERA = a + b * xwOBA, weighted by IP
  let sumW = 0,
    sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (const p of points) {
    const w = p.ip;
    sumW += w;
    sumX += w * p.xwoba;
    sumY += w * p.era;
    sumXY += w * p.xwoba * p.era;
    sumXX += w * p.xwoba * p.xwoba;
  }
  const meanX = sumX / sumW;
  const meanY = sumY / sumW;
  const slope = (sumXY - sumW * meanX * meanY) / (sumXX - sumW * meanX * meanX);
  const intercept = meanY - slope * meanX;

  // R^2 for sanity
  let ssRes = 0,
    ssTot = 0;
  for (const p of points) {
    const yHat = intercept + slope * p.xwoba;
    ssRes += p.ip * (p.era - yHat) ** 2;
    ssTot += p.ip * (p.era - meanY) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;

  // 5. Output
  console.log("=== Calibration result ===");
  console.log(`League avg xwOBA:  ${meanX.toFixed(4)}`);
  console.log(`League avg ERA:    ${meanY.toFixed(2)}`);
  console.log(`Slope:             ${slope.toFixed(2)} ERA per 1.0 xwOBA`);
  console.log(`Intercept:         ${intercept.toFixed(2)}`);
  console.log(`R² (IP-weighted):  ${r2.toFixed(3)}\n`);

  console.log("Wire these into src/savant/lib/pitchLogRates.ts:\n");
  console.log(`const COLLEGE_LEAGUE_AVG_XWOBA = ${meanX.toFixed(4)};`);
  console.log(`const COLLEGE_LEAGUE_AVG_ERA = ${meanY.toFixed(2)};`);
  console.log(`const XERA_SLOPE = ${slope.toFixed(2)};\n`);

  // Spot-check: 5 random pitchers
  console.log("Spot-check (5 random qualified pitchers):");
  const shuffled = [...points].sort(() => 0).slice(0, 5);
  for (const p of shuffled) {
    const xera = meanY + slope * (p.xwoba - meanX);
    console.log(
      `  xwOBA=${p.xwoba.toFixed(3)}, actual ERA=${p.era.toFixed(2)}, xERA=${xera.toFixed(2)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
