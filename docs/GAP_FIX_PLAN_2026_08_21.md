# GAP-FIX PLAN (post-audit, 2026-08-21) — resumable

Fixing the 5 audit gaps IN ORDER. Each = status + exact approach so we can resume if cut off. Context: the transfer/HTP/conf-stats/snapshot chain is settled + re-run on staging; these are the remaining correctness gaps before display-wiring + prod. Full audit: this session; pipeline: `FULL_PIPELINE_WALKTHROUGH_2026_08_21.md`.

## GAP 1 — Faced-competition for independents (Oregon State bug) [IN PROGRESS]
**Problem:** transfer competition term for an INDEPENDENT from-program uses that program's OWN conference HTP/Stuff+ (Oregon State 124.6/109.4) instead of the SCHEDULE-FACED value (104.47/100.22). `team_season_stats.faced_htp`/`faced_stuff_plus` are computed + stored (verified 308/308) but read by ZERO consumers.
**Verified:** faced computed in `scripts/sql/team_season_stats_faced_park.sql` (faced_htp(T)=pitch-weighted conf HTP of hitters T's pitchers faced; faced_stuff_plus(T)=conf Stuff+ of pitchers T's hitters faced). Oregon State (src=3111) faced_htp 104.47 / faced_stuff 100.22. Only 1 independent in 2026, but wire generally.
**Fix (approach):**
1. team_season_stats MUST run BEFORE transfers (order: 9 → 11-faced → 10). It's populated already; just an ordering rule for the edge fn + prod runbook.
2. Transfer scripts load `team_season_stats.faced_htp`/`faced_stuff_plus` by `source_id` (map). Pitcher `precompute-pitchers.ts`; hitter `precompute-transfer-projections.ts`.
3. In the builders, when the FROM program is independent (fromConference matches 'Independent'), OVERRIDE the from-competition:
   - Pitcher (`buildTransferPitcherInputs.ts:200,230`): `fromHitterTalent = faced_htp` (not `fromPC.hitter_talent_plus`).
   - Hitter (`buildTransferProjectionInputs.ts`): `fromStuff = faced_stuff_plus` (not conf Stuff+).
   - Conference members keep conf-avg (a valid proxy). TO side = customer team (conf member) → conf HTP fine.
4. Mirror into the edge fn (`process-precompute-jobs`).
5. Re-run transfers (only independents' players change materially).
**Test:** an Oregon State pitcher → SEC should project on faced HTP 104.47 (competition delta smaller than with 124.6).

## GAP 2 — Edge fn `?? 100` fallbacks → block/null [TODO]
`process-precompute-jobs/index.ts:455 (safePR), 1475-1480 (env+), 1499/1501 (HTP)` default missing conf data to league-average 100; the batch uses `?? null` + `requireNum` block. On prod (if conf cols empty) → silent league-average projections. **Fix:** change `?? 100` → `?? null` for env+/HTP/PR and block the player when null (match `buildTransferPitcherInputs` behavior). Deno edge fn → Trevor deploys.

## GAP 3 — Codify 9a raw-rate assembly + 9f WRC_plus [TODO — ★★★★ prod blocker]
`scripts/sql/conf_stats_unified_assembly.sql:24-30` has the whole `UPDATE "Conference Stats"` (raw rates + `WRC_plus`) COMMENTED OUT. **Fix:** commit a runnable producer (un-comment into a `--file` migration or a tsx script) so rates + WRC_plus reproduce on prod. Without it, prod conf cols are empty → env+/HTP/transfers/Program Analytics break. Verify on staging (idempotent) then it joins the conf-stats-derive step.

## GAP 4 — Stale HTP display sites [✅ DONE 2026-08-21]
`PitcherPage.tsx:282` + `PitchingConferenceStatsTable.tsx:370` now read STORED `hitter_talent_plus` (were live pre-swap `100−wrc_plus`). Committed f39e50e.

## GAP 5 — Hitter transfer park omits source_team_id [TODO]
`buildTransferProjectionInputs.ts` park resolver passes `teamId` but not `sourceTeamId` → uses per-season UUID→name instead of the stable-program path (pitcher side already threads source_team_id). **Fix:** pass `fromTeam.source_id`/`toTeam.source_id` as `sourceTeamId` to `resolveMetricParkFactor`.

## ORDER: 1 → 2 → 5 → 3 (3 is a bigger codify task; do the code gaps 1/2/5 first, then 3). Display HTP (4) done.
## THEN: display-wiring audit (player eval + front office) → market-value re-eval → deploy edge fn → unify (Track B) → prod.
