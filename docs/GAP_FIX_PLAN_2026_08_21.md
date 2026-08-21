# GAP-FIX PLAN (post-audit, 2026-08-21) — resumable

Fixing the 5 audit gaps IN ORDER. Each = status + exact approach so we can resume if cut off. Context: the transfer/HTP/conf-stats/snapshot chain is settled + re-run on staging; these are the remaining correctness gaps before display-wiring + prod. Full audit: this session; pipeline: `FULL_PIPELINE_WALKTHROUGH_2026_08_21.md`.

## GAP 1 — Faced-competition for independents [✅ FULLY DONE — batch f733986, re-run done, edge-fn mirror 1c7603a]
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

## GAP 2 — Edge fn `?? 100` fallbacks → block/null [✅ DONE — bf69bd1]
**Resolution:** the ONLY live risk was the PITCHER env+/HTP `?? 100` (empty conf cols → silent league-average). Added a D1-only block guard right after the raw-stats guard: if any of `fromPC/toPC.{era,fip,whip,k9,bb9,hr9}_plus` or `.hitter_talent_plus` is null → `blocked++` (reason `missing_conf_stats`), matching the batch's `requireNum`. JUCO/D2 keep their override path (env+ null by design).
The HITTER side already blocked correctly pre-existing: env+ (`fromAvgPlus`…`toStuff`) via `missingInputs` push at :397-404, and hitter PR via :372-374. `safePR:455` only ever fires for JUCO (D1 PR already blocked) → moot for D1, left as-is. Deno edge fn → Trevor deploys.

## GAP 3 — Codify 9a raw-rate assembly + 9f WRC_plus [✅ DONE + STAGING-VERIFIED 2026-08-21 (Trevor ran the diff: all 29 D1 confs 0.0000 across AVG/OBP/ISO/ERA/FIP/K9/WHIP/WRC+; Independent correctly absent — no intra-conf games)]
`scripts/sql/conf_stats_unified_assembly.sql:24-30` had the whole `UPDATE "Conference Stats"` COMMENTED OUT (hand-run on staging 2026-08-18, no committed producer → prod cols would be EMPTY).
**Resolution:** committed `scripts/sql/conf_stats_bucketA_assembly.sql` — runnable, idempotent, self-contained: inlines `_team_conf` as a `team_conf` CTE (`Teams Table` Season 2026 `source_id`→`conference_id`, deduped `distinct on`), builds temp `_conf_agg`, runs the verbatim validated UPDATE (AVG/OBP/ISO/SLG/OPS + ba/obp/slg/iso_plus + WRC_plus C1 + K9/BB9/HR9/WHIP + FIP cFIP 3.157 + ERA DRS-earned), txn-wrapped. The aggregate SQL is copied verbatim from the 2026-08-18 validated run (corr 0.98+); only the `_team_conf` inline was reconstructed from the is_conference_game spec §0 (same lookup that backfill used).
**✅ GATE CLEARED 2026-08-21:** Trevor ran a staging read-only diff (rebuild `_conf_agg` via the committed CTE, join stored) — **all 29 D1 confs 0.0000** across AVG/OBP/ISO/ERA/FIP/K9/WHIP/WRC+. The inlined `team_conf` reproduces the original helper exactly; WRC+ delta 0 too (stored was already current-C1). Independent correctly absent (0 intra-conf games → no Bucket-A row; uses faced-competition). Producer is prod-ready (paste, do NOT `--linked` = PROD). Env+ denominators (avg .2777/obp .3823/slg .4365/iso .1588) + cFIP 3.157 are hardcoded 2026 D1 (ncaa_averages) — re-read for a new season.

## GAP 4 — Stale HTP display sites [✅ DONE 2026-08-21]
`PitcherPage.tsx:282` + `PitchingConferenceStatsTable.tsx:370` now read STORED `hitter_talent_plus` (were live pre-swap `100−wrc_plus`). Committed f39e50e.

## GAP 5 — Hitter transfer park omits source_team_id [DEFERRED — minor]
`buildTransferProjectionInputs.ts` park resolver passes `teamId` but not `sourceTeamId` → uses per-season UUID→name instead of the stable-program path (pitcher side already threads source_team_id). **Fix:** pass `fromTeam.source_id`/`toTeam.source_id` as `sourceTeamId` to `resolveMetricParkFactor`.

## ORDER: 1 → 2 → 5 → 3 (3 is a bigger codify task; do the code gaps 1/2/5 first, then 3). Display HTP (4) done.
## THEN: display-wiring audit (player eval + front office) → market-value re-eval → deploy edge fn → unify (Track B) → prod.

## PROGRESS (2026-08-21)
- GAP 1 ✅ FULLY DONE. batch (f733986): faced wired into both builders + callers. Re-run of all 17 teams complete (`_run_step2_all.sh` → hitter ~4988 / pitcher ~5064 computed per team; runner greps output so the "faced_htp rows" log line isn't captured — code path confirmed present + executed). Edge-fn mirror (1c7603a): faced map loaded in BOTH the hitter-scope and pitcher-scope handlers (they're separate fns each with own teams map), `source_id` added to both team-map rows, hitter `fromStuff` + pitcher `fromHitterTalent` override when `/independ/i` matches from-conf.
- GAP 2 ✅ DONE (bf69bd1): pitcher env+/HTP D1 block guard. Hitter side already blocked (missingInputs); safePR JUCO-only.
- GAP 4 ✅ done (display HTP).
- GAP 5 DEFERRED (minor): needs the `resolveParkFactor` callback signature to accept sourceTeamId + fromTeam to carry source_id. UUID→name path works today. Low urgency.
- deno check on the edge fn = 2 PRE-EXISTING errors only (`:659` pwar_runs_per_win===0 literal cmp; `:1276` JUCO spread literal-type) — NOT from these edits.
- GAP 3 ✅ CODIFIED (a960334): `scripts/sql/conf_stats_bucketA_assembly.sql`. ★★★★ blocker cleared in code; ONE remaining gate = staging idempotent re-run vs `_confstats_backup_preassembly` (blocked this session: no staging conn, CLI linked=PROD).
- **NEXT: GAP 5 (deferred-minor, optional) → then the real next phase: display-wiring audit (player eval + front office) → market-value re-eval → deploy edge fn (Trevor) → unify (Track B) → prod.**
- ⚠️ INFRA NOTE for whoever resumes: `supabase --linked` = PROD (`trbvxuoliwrfowibatkm`); staging is `slrxowawbijbjrkozqlj` (.env.local). No Supabase MCP was connected this session. To run staging SQL: re-link or reconnect MCP; NEVER run conf-stats writes via `--linked` as-is (that's prod).
