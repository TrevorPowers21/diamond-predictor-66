/**
 * 🛑 PARTLY LEGACY — last touched 2026-08-20, but TWO of its steps are dead:
 *   • `calculateConferenceStuffPlus` = the LEGACY conference Stuff+ (src/savant/lib/conferenceStuffPlus.ts,
 *     2026-04-26). The canonical producer is `conferenceStuffPlusV2` — pitch-weighted from
 *     `"Pitching Master".stuff_plus x trackman_pitches`. Running the legacy one re-introduces the stale 101.17
 *     value that C28 step 4 fixed to 99.15 on prod.
 *   • `bulkRecalculatePredictionsLocal` = a STUB (predictionEngine.ts:875).
 * Use docs/PLAN_finish_prod_push_2026_08_31.md for the current ordered sequence.
 */
#!/usr/bin/env node
/**
 * Replay the post-import cascade for a given season. Used to recover after a
 * data restore (e.g. JUCO recovery) where the bulk importer skipped the
 * computational cascade.
 *
 * Runs (in order):
 *   1. addMissingPlayers
 *   2. computeAndStoreNcaaAverages
 *   3. computeAndStoreAllScores
 *   4. computeAndStoreStdPr        (power-rating SDs, on the fresh ratings)
 *   5. createPredictionsFromMaster
 *   6. calculateConferenceStuffPlus
 *   7. computeConferenceEnvRates
 *   8. bulkRecalculatePredictionsLocal
 *
 * Usage:
 *   npx tsx scripts/recompute-cascade.ts          # staging
 *   npx tsx scripts/recompute-cascade.ts --prod   # prod
 */
import { addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { computeAndStoreStdPr } from "@/lib/computeStdPr";
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

  await step("addMissingPlayers", () => addMissingPlayers(DATA_SEASON));
  await step("computeAndStoreNcaaAverages", () => computeAndStoreNcaaAverages(DATA_SEASON));
  await step("computeAndStoreAllScores", () => computeAndStoreAllScores(DATA_SEASON));
  // std_pr = power-rating SDs. MUST run after computeAndStoreAllScores (needs the
  // freshly-recomputed *_power_rating / *_pr_plus columns) and before any
  // projection recompute so the SD-blend denominator is never stale.
  await step("computeAndStoreStdPr", () => computeAndStoreStdPr(DATA_SEASON));
  await step("createPredictionsFromMaster", () => createPredictionsFromMaster(DATA_SEASON, PROJ_SEASON));
  await step("calculateConferenceStuffPlus", () => calculateConferenceStuffPlus(DATA_SEASON));
  await step("computeConferenceEnvRates", () => computeConferenceEnvRates(DATA_SEASON));
  await step("bulkRecalculatePredictionsLocal", () => bulkRecalculatePredictionsLocal(PROJ_SEASON));

  console.log(`\n${C.green}✓✓✓  Cascade complete${C.reset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
