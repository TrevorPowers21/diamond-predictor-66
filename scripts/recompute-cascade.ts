#!/usr/bin/env node
/**
 * Replay the post-import cascade for a given season. Used after every data
 * upload (mid-season or season transition) to keep player_predictions current.
 *
 * Runs (in order):
 *   0. markOldProjectionsStale     ← NEW: stales all predictions from seasons
 *                                         older than PROJ_SEASON before writing
 *                                         fresh rows. Prevents dual-active
 *                                         collisions when seasons roll over.
 *   1. addMissingPlayers
 *   2. computeAndStoreNcaaAverages
 *   3. computeAndStoreAllScores
 *   4. createPredictionsFromMaster (returner + transfer regular rows via UPSERT)
 *   5. calculateConferenceStuffPlus
 *   6. computeConferenceEnvRates
 *   7. bulkRecalculatePredictionsLocal
 *
 * After the cascade, trigger the precompute Edge Function for each customer
 * team to refresh team-specific precomputed rows (transfer projections).
 * Use scripts/rerun_all_teams_precompute.ts for that step.
 *
 * Usage:
 *   npx tsx scripts/recompute-cascade.ts          # staging
 *   npx tsx scripts/recompute-cascade.ts --prod   # prod
 */
import { markOldProjectionsStale } from "@/lib/markOldProjectionsStale";
import { addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import { calculateConferenceStuffPlus } from "@/savant/lib/conferenceStuffPlus";
import { computeConferenceEnvRates } from "@/lib/importConferenceStats";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

// DATA steps (read Master tables, compute NCAA averages, conference rates,
// Stuff+) run against the actuals season — what's on the field.
// PROJECTION steps (write/recalc player_predictions rows) run against the
// projection season — what we predict for next year.
const DATA_SEASON = CURRENT_SEASON;
const PROJ_SEASON = PROJECTION_SEASON;
const C = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m" };

async function step(label: string, fn: () => Promise<any>) {
  console.log(`\n${C.cyan}→${C.reset} ${C.bold}${label}${C.reset}`);
  const start = Date.now();
  try {
    const res = await fn();
    const ms = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  ${C.green}✓${C.reset} done (${ms}s) ${res ? JSON.stringify(res).slice(0, 200) : ""}`);
  } catch (e) {
    console.error(`  ${C.red}✗${C.reset} ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

async function main() {
  const isProd = process.argv.includes("--prod");
  console.log(`${C.bold}Cascade replay — data ${DATA_SEASON} → projections ${PROJ_SEASON} on ${isProd ? "PROD" : "STAGING"}${C.reset}`);

  // Step 0: stale old-season predictions before writing new ones.
  // Prevents dual-active collisions on season rollover (e.g. 2027→2028).
  // Idempotent on repeated mid-season uploads — only affects seasons < PROJ_SEASON.
  await step("markOldProjectionsStale", () => markOldProjectionsStale(PROJ_SEASON));

  await step("addMissingPlayers", () => addMissingPlayers(DATA_SEASON));
  await step("computeAndStoreNcaaAverages", () => computeAndStoreNcaaAverages(DATA_SEASON));
  await step("computeAndStoreAllScores", () => computeAndStoreAllScores(DATA_SEASON));
  await step("createPredictionsFromMaster", () => createPredictionsFromMaster(DATA_SEASON, PROJ_SEASON));
  await step("calculateConferenceStuffPlus", () => calculateConferenceStuffPlus(DATA_SEASON));
  await step("computeConferenceEnvRates", () => computeConferenceEnvRates(DATA_SEASON));
  await step("bulkRecalculatePredictionsLocal", () => bulkRecalculatePredictionsLocal(PROJ_SEASON));

  console.log(`\n${C.green}✓✓✓  Cascade complete${C.reset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
