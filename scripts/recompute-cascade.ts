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
 *   4. createPredictionsFromMaster
 *   5. calculateConferenceStuffPlus
 *   6. computeConferenceEnvRates
 *   7. bulkRecalculatePredictionsLocal
 *
 * Usage:
 *   npx tsx scripts/recompute-cascade.ts          # staging
 *   npx tsx scripts/recompute-cascade.ts --prod   # prod
 */
import { addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import { calculateConferenceStuffPlus } from "@/savant/lib/conferenceStuffPlus";
import { computeConferenceEnvRates } from "@/lib/importConferenceStats";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";

const SEASON = 2026;
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
  console.log(`${C.bold}Cascade replay — season ${SEASON} on ${isProd ? "PROD" : "STAGING"}${C.reset}`);

  await step("addMissingPlayers", () => addMissingPlayers(SEASON));
  await step("computeAndStoreNcaaAverages", () => computeAndStoreNcaaAverages(SEASON));
  await step("computeAndStoreAllScores", () => computeAndStoreAllScores(SEASON));
  await step("createPredictionsFromMaster", () => createPredictionsFromMaster(SEASON));
  await step("calculateConferenceStuffPlus", () => calculateConferenceStuffPlus(SEASON));
  await step("computeConferenceEnvRates", () => computeConferenceEnvRates(SEASON));
  await step("bulkRecalculatePredictionsLocal", () => bulkRecalculatePredictionsLocal(SEASON));

  console.log(`\n${C.green}✓✓✓  Cascade complete${C.reset}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
