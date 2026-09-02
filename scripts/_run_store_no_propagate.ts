/**
 * Re-run the +stat STORE on staging — power ratings ONLY, no propagate to player_predictions,
 * no projection recompute. Picks up the fetchAllPrior pagination fix + the in_zone_pct backfill.
 *   npx tsx --env-file-if-exists=.env.local scripts/_run_store_no_propagate.ts
 */
import { computeAndStoreHitterScores, computeAndStorePitchingScores } from "@/lib/computeAndStoreScores";

const season = 2026;
// ★ STAGE-0 guard (2026-08-30): this script had NO env guard and its banner claimed "staging" while it would
// happily write PROD via --env-file. C26 depends on C27 having run first (computeAndStoreScores reads ncaa_averages
// and silently falls back to HARDCODED defaults for any missing field), so a wrong-env run is doubly bad.
const _url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const _isProd = /trbvxuoliwrfowibatkm/.test(_url);
const _prodFlag = process.argv.includes("--prod");
if (_isProd && !_prodFlag) { console.error("✗ URL is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!_isProd && _prodFlag) { console.error("✗ --prod passed but URL is not prod — refusing."); process.exit(1); }
console.log(`[env] ${_isProd ? "PROD" : "STAGING/other"}`);
console.log(`=== re-store power ratings for ${season} (propagate=false, ${_isProd ? "PROD" : "staging"}) ===`);
const p = await computeAndStorePitchingScores(season, undefined, { propagate: false });
console.log(`pitchers: ${p.updated} updated, ${p.errors} errors`);
const h = await computeAndStoreHitterScores(season, { propagate: false });
console.log(`hitters: ${h.updated} updated, ${h.errors} errors`);
console.log("done — Master +stat columns rewritten; player_predictions untouched.");
