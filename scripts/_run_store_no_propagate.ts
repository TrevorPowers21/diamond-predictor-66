/**
 * Re-run the +stat STORE on staging — power ratings ONLY, no propagate to player_predictions,
 * no projection recompute. Picks up the fetchAllPrior pagination fix + the in_zone_pct backfill.
 *   npx tsx --env-file-if-exists=.env.local scripts/_run_store_no_propagate.ts
 */
import { computeAndStoreHitterScores, computeAndStorePitchingScores } from "@/lib/computeAndStoreScores";

const season = 2026;
console.log(`=== re-store power ratings for ${season} (propagate=false, staging) ===`);
const p = await computeAndStorePitchingScores(season, undefined, { propagate: false });
console.log(`pitchers: ${p.updated} updated, ${p.errors} errors`);
const h = await computeAndStoreHitterScores(season, { propagate: false });
console.log(`hitters: ${h.updated} updated, ${h.errors} errors`);
console.log("done — Master +stat columns rewritten; player_predictions untouched.");
