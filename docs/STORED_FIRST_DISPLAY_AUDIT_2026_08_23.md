# STORED-FIRST DISPLAY AUDIT (2026-08-23)

Goal (Trevor): every value displayed = the STORED (projected) value, defaulting to stored ON LOAD.
Only exception: a LOCAL, non-persisting toggle session on player/pitcher profiles that recomputes OFF WAR.
Method: 4 parallel agents (player-eval surfaces · GM/TeamBuilder/board · projected-vs-prevseason+RLS+coverage) + DB checks.

## ✅ CORE RESULT — projection/valuation numbers are STORED-FIRST everywhere on load
Every oWAR / pWAR / total WAR / market·NIL / wRC+ / pRV+ / projected rate (pAVG/pOBP/pSLG/pOPS/pISO) is a stored
read on load across ALL surfaces: TransferPortal, PlayerComparison, PlayerHub overview, ReturningPlayers main tables,
GM roster/board, Team Builder (clean rows), profiles (default). No live WAR/market recompute on clean load.

- **Projected-not-prev-season: CLEAN.** All 4 writers store projection OUTPUT in p_*/WAR/market; prior-season only in from_* (inputs). No from_* leaks into a p_* column.
- **Coverage: CLEAN.** DB (today's 202,563 rows): hitters total_hitter_war 99.6% / market 100% / p_wrc_plus 100% / p_avg 100%; pitchers market 100% / p_rv_plus 100%. Low-sample rule = 75 AB/25 IP blend, 15/5 noise floor (~3%). Nulls are role/JUCO/TWP/Independent by design.
- **Toggle previews default to STORED on load — VERIFIED.** PlayerProfile (`computedNilValuation` = toggleMovedWar ? recomputed-from-total_hitter_war : storedMarketValue; init seeds dev-agg/depth from stored → scale=1 → reads stored) + PitcherProfile (`projectedPitching.marketValue` = pitcherToggled ? overlay : storedPitcherMarket). Recompute flows through WAR, never market-scaling.

## ⚠️ THE ONE SYSTEMIC GAP — current-season SCOUTING-GRADE / POWER-RATING display is pitch-log-LIVE
The scout 20-80 chips + env+/Stuff+ "internal power ratings" are recomputed live from pitch_log (percentileRank over
the season population) at render and OVERRIDE the stored `*_score` / `*_power_rating` columns. Deliberate (so a player
ranks identically across surfaces) but violates the stored-first rule. Sites:
1. **PlayerHub pitcher advanced chips** — `src/hooks/usePlayerHubPreview.ts:57-69`. Live, **NO stored fallback** (null if no pitch-log). HARD violation. Should read stored `pitcher_stuff_score/whiff_score/bb_score/barrel_score` (same cols PitcherProfile reads).
2. **ReturningPlayers scout mini-chips** — pitcher `:3487-3491` (`live ?? r.stuff_score`), hitter `:3147`. Live wins over stored `*_score`.
3. **PlayerProfile `activeSeasonScoutingGrades`** — `:886-913`. env+ (PR+) + scout grades pitch-log-FIRST over stored `*_power_rating`/`*_score` (admin-only Internal Power Ratings panel).
4. **Target Board scouting chips** — `src/pages/targets/TargetBoardSubtab.tsx:260-281,645-655,767-780`. Live percentile, stored `*_score` fallback only if pop missing.
5. **PitcherProfile Stuff+ score** — `:1019-1025`. No stored Stuff+ score COLUMN exists → always live (structural gap; other pitcher scores here ARE stored-first). Needs a stored `pitcher_stuff_score` column.

**Fix pattern:** invert precedence `live ?? stored` → `stored ?? live` (or drop the live override); give usePlayerHubPreview a stored read; add a stored Stuff+ score column. DECISION (Trevor): enforce stored-first on scouting grades, or keep live percentile for cross-surface consistency?

## ⚠️ RLS — player_predictions is globally readable (v1 design)
`player_predictions FOR SELECT USING (true)` (`20260211192838…:82`) — any authenticated user reads every row; team-scoping is APP-CODE only (`teamScopedPredictions.ts` `applyTeamScopeFilter`). Same `USING(true)` on nil_valuations/players/season_stats/power_ratings. Migration comment says intentional v1. Sibling roster tables (target_board/team_builds/team_build_players/coach_notes) ARE properly `is_team_member`-scoped.
**Fix if DB-level confidentiality wanted:** replace with `USING (customer_team_id IS NULL OR is_team_member(customer_team_id))` (keeps shared global rows + own-team rows). Writes already admin-gated.

## Minor (low severity)
- **TWP market helper bypassed** in 3 GM/board readers (hand-rolled twp_* pick; read-equivalent). `loadGmBuildRoster.ts:32` not side-aware — a TWP snapshot carrying both twp fields could mis-side. Route all through `pickHitter/PitcherMarketValue`.
- **PitcherProfile pWar/pRV+/rates latent risk** — no explicit `toggled ? recompute : stored` fallback (unlike marketValue); rely on formula parity + `DEFAULT_PITCHING_DEV_AGGRESSIVENESS=0`. If a row is ever stored with non-zero dev_aggressiveness, they'd double-apply dev on load. Hitter path guards this (true session/stored ratio). Add the same guard.
- **GMTargets "Add to Roster"** snapshot selects only WAR/market cols → rostered target's rate columns (p_avg/p_era…) show "—".
- Dead imports: `computeTransferProjection`/`computeHitterPowerRatings` in TransferPortal (never called). `deriveHitterStored` (predictionEngine) dead.

## Bottom line
The numbers that drive board + pay (WAR, market, projected rates, wRC+/pRV+) are solidly stored-first on load, and the
toggle previews correctly default to stored. The remaining stored-first deviation is the **live scouting-grade/power-rating
display layer** (5 sites) — a deliberate design choice that conflicts with the stated rule; needs a decision. Plus the
RLS tightening (optional, v1 design) and the minor TWP/pitcher-rate guards.
