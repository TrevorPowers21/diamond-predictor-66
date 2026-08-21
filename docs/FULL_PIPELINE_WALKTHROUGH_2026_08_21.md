# FULL PIPELINE — pitch-log ingest → refresh snapshot (confirmed 2026-08-21)

The end-to-end process, every step CONFIRMED on `feature/war-recalibration` (staging). This IS the spec for the ONE unified edge function (Track B): each numbered step is a module that folds into the on-upload edge fn. D1 only, JUCO out of scope (separate fn). Nothing is live-computed downstream — every displayed value reads a STORED column.

Companion specs: `PIPELINE_pitch_log_to_projections.md`, `TRANSFER_EQUATION_LINEAGE_2026_08_21.md`, `CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.

## THE 12 STEPS (in dependency order)

### 1. Pitch-log ingest → totals
`ingest_pitch_log.ts` → `pitch_log` (+ `park_code`, `game_string`, `is_conference_game`, pitcher_full_name resolved from pitcher_id). SQL rollups → `pitch_log_hitter_totals` / `pitch_log_pitcher_totals`. **Per-pitcher IP** via out-attribution (added `pitch_log_pitcher_totals.ip`; corr 0.9995 vs Master). ✅

### 2. Derive Masters from pitch log
`derive_masters_from_pitchlog.ts` → `Hitter Master` + `Pitching Master` full line (rates + scouting + K9/BB9/HR9/WHIP + **descriptive classic FIP** `(13·HR+3·(BB+HBP)−2·K)/IP+3.157`). TruMedia = sporadic fill/override (null/thin → keep Master). Keyed `source_player_id`+Season. ✅

### 3. Stuff+ rollup → Master
`recompute-stuff-plus.ts` (reclassify → per-pitch Stuff+ vs D1 baseline → `rollupStuffPlusToMaster`). Input to pitcher power ratings (k9⁺/era⁺/whip⁺). ✅

### 4. ncaa_averages
`computeNcaaAverages.ts` → means (PA/IP-weighted) + SDs (qualified AB≥75/IP≥25). **Dual-writes to `ncaa_averages` AND `model_config`** (p_ncaa_avg_*/p_sd_*/r_*/t_*). Pitcher exit-velo/ev90/in_zone pinned = hitter 1-for-1. ✅

### 5. compute_scores → power ratings
`computeAndStoreAllScores.ts` → `*_score` = scoreFromNormal(metric, ncaa_mean, ncaa_sd) → composites `/50·100` → `*_power_rating` / `*_pr_plus` back on the Masters. `obp_power_rating` = the returner SD-blend's `from_obp_plus`. ✅

### 6. std_pr (power-rating SDs)
`computeStdPr.ts` → r_*/t_*_std_pr (+ p_*_pr_sd) → model_config + code. Re-measured on current ratings (must re-run after any recompute). Wired into `recompute-cascade`. ✅

### 7. create_predictions
`createPredictionsFromMaster.ts` → `player_predictions` returner/regular, **season 2027**. **Writes per-stat `from_avg_plus/from_obp_plus/from_slg_plus`** (= ba/obp/iso_power_rating) — the returner SD-blend input. ✅

### 8. Returner recompute
`precompute-returner-hitters.ts` (recalcReturner SD-blend) + `precompute-returner-pitchers.ts` (computePitcherProjection). The stored returner projection (base for own-roster players). ✅

### 9. CONFERENCE-STATS build (the conf-stats-derive step) — feeds transfers
Order: raw counting (PA/AB) + rates → env+ → Stuff+/OPR → park → HTP last.
- **9a Raw rates** (AVG/OBP/…/ERA/FIP, intra-conf `is_conference_game=true`): pitch-log Bucket-A assembly. ⚠️ **STILL HAND-RUN SQL — must codify.**
- **9b Hitter env+** (ba/obp/iso/slg_plus = rate/ncaa·100): `computeConferenceEnvRates` (cascade). ✅ STORED
- **9c Pitcher env+** (era…hr9_plus, ratio): `compute_conf_pitcher_env_plus.ts` (mig 20260821000000). ✅ STORED
- **9d Stuff+ / Overall_Power_Rating**: Stuff+ rollup + `populate-conference-stats-env-plus` (Overall_PR = PA-avg hitters' overall PR). ✅
- **9e OPR** (`offensive_power_rating` = Overall_Power_Rating): `derive_conf_opr_htp.ts`. ✅ committed
- **9f WRC_plus** (C1 OBP/SLG): ⚠️ **STILL commented-out SQL — must codify.**
- **9g run_env_factor** (conf-avg member `rg_factor`): `derive_conf_opr_htp.ts`. ✅ committed (verified exact)
- **9h HTP** (`hitter_talent_plus` = OPR + 1.25·(Stuff+−100) + 0.75·(100−run_env_factor), PARK SWAP): `derive_conf_opr_htp.ts`. ✅ STORED, read-only, one canonical value everywhere.

### 10. TRANSFER projections
`precompute-transfer-projections.ts` (hitter) + `precompute-pitchers.ts` (pitcher), per customer team. Reads: Master `*_power_rating`/`*_pr_plus` (by source_player_id); Conference Stats env+/Stuff+/HTP **all STORED, no live compute**; Park Factors per-team (hitter uses lhb/rhb handedness; pitcher combined); model_config weights (both sides, re-tuned to target %impact). Team resolution **id-first** (source_team_id). Equation: power-blend → env translation (conf ~1% / competition 4% / park) → class+dev → depth role → WAR → market. Writes `player_predictions` transfer/precomputed/2027. ✅ re-run all 17 customer teams.

### 11. team_season_stats (Program Analytics) — ⚠️ MUST RUN BEFORE STEP 10 (order correction, Trevor 2026-08-21)
`refresh_team_season_stats(season)` → Σ Masters **descriptive** WAR (owar/dwar/bsrwar/pwar reg+total) + conf context (conf_stuff_plus/conf_htp/conf_opr from Conference Stats) + **faced-competition (faced_stuff_plus/faced_htp)** + park + records. 308 D1 rows. Descriptive (actual season), separate from projections. ✅ populated.
**⚠️ CORRECTION: this belongs BEFORE transfers (step 10), because `faced_stuff_plus`/`faced_htp` are the CORRECT competition input for INDEPENDENT programs** (Oregon State: 0 conf games → schedule-weighted faced HTP ~104.6, NOT the Independent conference's own 124.6). Correct order: 9 → 11(faced) → 10.
**⚠️ WIRING GAP (found 2026-08-21):** the transfer projections do NOT read `faced_stuff_plus`/`faced_htp` — independents use the "Independent" Conference Stats row's OWN HTP (124.6) instead of faced (~104.6), over-stating the competition they faced. Narrow (Oregon State only in 2026) but a real inaccuracy. FIX = wire the transfer competition term to read `team_season_stats.faced_htp`/`faced_stuff_plus` when the from-program is independent. [[project_faced_competition_independents]]

### 12. Snapshot refresh (the "automatic function")
`backfill-neutral-snapshot.ts` → `neutral_snapshot` from current predictions (**team-scoped pick: this-team precomputed → global regular → bounded fallback; NEVER another team's data**) → `heal-stale-snapshots.ts` → `player_snapshot`/`transfer_snapshot = projectEffectiveWar(neutral, production_notes)`. **Toggles (`production_notes`) never written.** Covers ALL builds incl. default rosters + target_board. RLS: program-scoped by customer_team_id. ✅

## DATA-INTEGRITY INVARIANTS (must hold in the edge fn)
- Every displayed value reads a STORED column (env+, HTP, projections, snapshots) — **no live compute** anywhere.
- Team resolution by **ID** (source_team_id), never name.
- Snapshot selection **team-scoped** (never another team's precompute); toggles preserved.
- Conference Stats keyed `conference_id`+season; clean D1=30 (NJCAA excluded).
- JUCO = separate function (blocked from D1 path via null stored env+).

## ⚠️ NOT YET AUTOMATIC / prod-push blockers
- **9a raw-rate assembly + 9f WRC_plus** = hand-run SQL → codify before prod (else empty on prod → transfers/HTP/Program Analytics break). ★★★★
- Steps 1–12 are separate scripts today; the edge fn folds them into ONE on-upload run.
- New-team path = `process-precompute-jobs` edge fn (code fixed to match; ⏳ Trevor deploy).

## WHAT'S NEXT (plan)
1. **Codify the two hand-run producers** (9a raw-rate pitch-log assembly, 9f WRC_plus) — removes the prod-push blocker.
2. **Display wiring audit** — map EVERY surface that shows these stats (Team Builder, GM roster/hub, Program Analytics team snapshots, target board, Conference Stats page, player/pitcher profiles) and confirm each reads the STORED value → accurate + consistent everywhere. (The next work session.)
3. **⭐ MARKET VALUE equation — evaluate/redo** (Trevor 2026-08-21): revisit even against prior coach feedback. Hitter = total_hitter_war × $/WAR × conf tier × position PVM; pitcher = p_war × $/WAR × tier (no PVF). Decide the model before prod.
4. **Deploy `process-precompute-jobs` edge fn** (Trevor) — new-team path.
5. **Unify Steps 1–12 into ONE edge fn** (Track B) — autonomous on upload; retire the drifted copies + hand-run SQL.
6. **Prod push** — the runbook, Trevor drives.
7. Deferred: JUCO separate fn; players.team_id backfill; NCAA anchors → ncaa_averages read; conference-to-conference rollups.
