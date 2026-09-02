/**
 * C28b — RUN CONFERENCE SCOUTING AVERAGES. Fills the per-conference scouting scores on "Conference Stats",
 * including `pitcher_ev_score` / `pitcher_iz_score`, which were 0/30 on BOTH prod and staging because this producer
 * had never been run for 2026 (they are NOT deprecated — `conferenceScoutingAverages.ts:453,:455` writes them).
 *
 * PRE-FLIGHT (2026-08-30):
 *  LANE     ✅ reads `ncaa_averages` (refreshed by C27) + the Masters (refreshed by C25/C26). No legacy PSP-I.
 *  PAGINATION ✅ `fetchAll` already orders by `source_player_id`.
 *  ORDER    ✅ requires ncaa_averages — C27 has run. The producer ERRORS explicitly if baselines are missing
 *              ("run Compute NCAA Averages first"), so there is NO silent default fallback here.
 *  BACKUP   ✅ `_confstats_backup` exists on prod (162 rows); `_c28_before` holds the pre-C28 2026 snapshot.
 *  GUARD    ⬅ this file. The library function has no env guard of its own.
 *
 *   staging: npx tsx --env-file=.env.local scripts/run_conference_scouting_averages.ts
 *   prod:    npx tsx --env-file=.env.production.local scripts/run_conference_scouting_averages.ts --prod
 */
import { computeConferenceScoutingAverages } from "../src/savant/lib/conferenceScoutingAverages.ts";

const SEASON = Number((process.argv.find((a) => a.startsWith("--season=")) || "").split("=")[1] || 2026);

// ── double-keyed env guard: the URL and the --prod flag must AGREE ─────────────
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const isProd = /trbvxuoliwrfowibatkm/.test(url);
const prodFlag = process.argv.includes("--prod");
if (isProd && !prodFlag) { console.error("✗ URL is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!isProd && prodFlag) { console.error("✗ --prod passed but URL is not prod — refusing."); process.exit(1); }
console.log(`[env] ${isProd ? "PROD" : "STAGING/other"}  season=${SEASON}`);

const { report, errors } = await computeConferenceScoutingAverages(SEASON);
const rows = (report as any)?.conferences ?? (report as any)?.rows ?? [];
console.log(`conferences computed: ${Array.isArray(rows) ? rows.length : "?"}`);
if (errors.length) { console.error(`errors (${errors.length}):`); errors.slice(0, 5).forEach((e) => console.error(`  ${e}`)); }
else console.log("no errors.");
