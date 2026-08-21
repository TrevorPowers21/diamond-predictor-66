# AGENT LEARNINGS — WAR Recalibration Audit + Plan (2026-08-20)

Companion to `docs/AUDIT_war_recalibration_state.md` (findings) and `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` (the 13-step plan + DB ledger + execution order). This file = the non-obvious learnings so the next session doesn't re-derive them.

## Verified clean (don't re-audit)
- **WAR formulas** (wRC+ C1, oWAR, pRV+/D1-FIP, pWAR) exact + consistent across `src/`, edge fns, SQL; composite `total=o+d+bsr` reproduces on staging to full precision; **269/269 tests pass**.
- **Power-rating canonical** (`powerRatings.ts`) matches the 2026-08-11 refits; stored `*_pr_plus` reproduce from stored scores (Δ<0.01).
- **team_season_stats** 308 teams, WAR rollups = Σ Masters **exactly (0.0000)**; records game_string-keyed (Georgia 53-14 / 23-7 SEC); pitcher_full_name corruption fixed (1 name/pitcher_id).
- **Migrations safe** — NO migration drops any irreplaceable table. `team_war_snapshots` DROP was only stale *doc language*.

## The real problems (all in the runbook as steps)
1. **`whip_pr_sd` 24.59→37.13** and **`obp_std_pr` 28.89→32.41** stale after composite refits. Confirmed on latest ratings (whip IP≥40, obp PA≥60). obp is returner+transfer (it's `StdDevOBPPowerRating`).
2. **Conference env+ inconsistency:** only the *player power ratings* got the /50×100 rebuild. The *conference env+* transfer lever still scales **pitchers z×20** while **hitters use the `(conf/ncaa)×100` ratio**. Missed step → put pitchers on the ratio.
3. **Broken recompute path:** commit `54cdb10` deleted `fetchAllPredictionsForReturnerMode` but it's still called in `bulkRecalculatePredictionsLocal` → ReferenceError. `vite build` hides it (esbuild transpile-only); `tsc` catches TS2304.
4. **NaN fallback** `pitcherProjection.ts:301-339` reads `eq.p_*` composite weights the code never defines → NaN (shadowed by stored values). Remove it.

## Edge-fn / model_config learnings (the biggest ones)
- **`recalculate-prediction` edge fn is the returner recompute target**, but its returner-hitter math is a **multiplicative model that ignores the power rating for OBP** (`usePR=false`). Trevor's intended model is the **SD-blend**: `ScaledOBP = NCAAAvgOBP + ((OBPPR+ − NCAAAvgPR)/StdDevOBPPR)×StdDevNCAAOBP` → blend → `×(1+ClassAdj+DevAgg·0.06)`. **Must be rewritten to use the power rating.**
- **The returner equation IS fully stored** in `model_config` as `r_*` keys under `model_type='admin_ui'` (std_pr, class bases, damp tiers, ncaa avgs, wRC weights). Trevor was right; store-everything is largely done.
- **The edge fn's model_config read is TRIPLE-BROKEN:** filters `model_type='returner'` (0 rows → all are `admin_ui`), checks **bare** key names (not `r_`-prefixed), and never reads `*_std_pr`. So it runs 100% on hardcoded Deno defaults. **Deno edge fns can't import `src/` → model_config IS their source of truth → everything must read it (rewire required).**
- **Recompute is fragmented:** returner hitters = `recalculate-prediction` edge fn; returner pitchers = `precompute-returner-pitchers.ts` script; transfer per-team = `process-precompute-jobs` edge fn — three separate Deno/TS math copies. Goal (logged): **consolidate into ONE edge fn.**
- **Edge-fn pitcher IP drift:** edge uses flat coarse-role IP (no `ip` input); canonical uses last-year-IP → depth role → projected IP (toggle-reactive). Fix in edge fn.

## Store-everything directive (Trevor 2026-08-20) — two modes
- **`src/` TS code:** code is source of truth; `model_config` + admin page hold a **read-only mirror** (matching values) for lookup/consistency.
- **Deno edge fns:** model_config is the **actual source** (they can't import code) → they MUST read it correctly.

## Flag resolutions (locked)
- `ncaa_averages` `pitcher_exit_velo`/`ev90`/`in_zone_pct` = the **hitter averages 1-for-1** (same batted-ball population), stored both sides.
- Conference-level `iso/obp_power_rating` (prod-only) are **live-read** by ConferenceStatsPage/Savant — **reconcile display, don't drop**. Per-player ba/obp/iso_power_rating (Masters) are used in projections + stay.
- `vaa` / `classification_version` — **known limitation, deferred** (upload miss).

## Run discipline
- **Run RETURNERS now** (post-fix, via edge fn). **Do NOT run TRANSFER** until its SD + weighted-impact (env+ ratio conversion + weights) is finished + verified.
- **JUCO entirely out of scope** — separate audit/session. Keep all this D1.

---

## PITCH-LOG-PRIMARY PIPELINE — Step 1 built (2026-08-20)

**Decision (Trevor):** upload pitch log → derive ALL metrics → write into BOTH `Hitter Master` + `Pitching Master`. TruMedia Master stays source of truth but **sporadic** (fill/override). Collapses today's two parallel sources (Masters=TruMedia drive projections; `pitch_log_*_totals` drive the Savant display, reconciled by `audit_pitch_log_vs_master.ts`) into one.

**Current state confirmed:** `ingest_pitch_log.ts` → `pitch_log` → SQL rollups → `pitch_log_hitter_totals`/`pitch_log_pitcher_totals`. `computeAndStoreScores` reads/writes `Hitter Master` (TruMedia-fed). No marry-into-Master function existed → that's what we built.

**Built:** `scripts/derive_masters_from_pitchlog.ts` (reuses `src/savant/lib/pitchLogRates.ts` `deriveHitterRates`/`derivePitcherRates`). D1 only. DRY-RUN verified, **NOT applied**. Fill/override: pitch-log primary; null/untracked or thin (`--min-pa 25`/`--min-bf 20`) → keep Master value (Master fills). Creates new rows for pitch-log-only players (needed for 2027).

**Hitter derive verified** (reproduces Master): AVG/SLG/ISO ~exact; OBP within ~0.01 (lib uses total `sac` for SF by documented v1 convention). Units: Master pct cols are 0-100 → ×100 the 0-1 lib rates; AVG/OBP/SLG/ISO stay rates; EV in mph.

**PITCHER IP via per-PA out-attribution (the hard part, SOLVED + validated):**
- Team method `Σ(max(outs)+1)/3` breaks at pitcher grain (relievers share a half-inning). Correct: outs on a PA = `next PA start-outs − this PA start-outs`; last PA = `max(outs)+1 − start`; credited to that PA's pitcher. Sums to the team total exactly.
- **Validated vs Master (n=2835, IP≥20): IP corr 0.9995 (avg −0.70 IP), K9 0.9971, BB9 0.9982, WHIP 0.9959.** The −0.70 = innings not reaching 3 outs in the log (end-of-game); Master fills it sporadically.
- Migration: `ALTER pitch_log_pitcher_totals ADD COLUMN ip numeric` + populate via the CTE (applied to staging 2026-08-20 by Trevor). Full SQL in `docs/PROD_PUSH_RUNBOOK_war_recalibration.md`.
- Rates from `ip` + existing counts (`total_k/total_bb/total_hbp/hits_*_allowed`): `K9=total_k·9/ip, BB9, HR9, WHIP=(Σhits+total_bb)/ip`.

**⭐ FIP — descriptive ≠ projection (Trevor's key distinction, caught by verifying):**
- `Pitching Master.FIP` = **descriptive/last-season classic FIP** = `(13·HR + 3·(BB+HBP) − 2·K)/IP + 3.157` (D1 cFIP). **Verified matches Master to ~0.01** (DeRossi 6.33/6.33 exact).
- `computeProjFip` (`pitcherQuality.ts`) = the **PROJECTION** D1-FIP regression index → feeds `pRV+`/`pWAR`. A DIFFERENT column/purpose. The subagent wrongly used it for the descriptive Master FIP → fixed to classic. **Never conflate descriptive last-season FIP with projection FIP.**

**Left to TruMedia Master (never derived):** `ERA` (earned-run attribution noisy), `IP, G, GS, Role`.

**Schema:** added UNIQUE `(source_player_id, Season)` on both Masters (was missing; needed for upsert). SQL in runbook.

**Change counts (dry-run, 2026):** 4,374 hitters / 4,772 pitchers would update.

**NEXT in the pipeline walkthrough:** `ncaa_averages` refresh (from new Masters) → `compute_scores` (Master → `*_score`/`*_power_rating`) → `create_predictions` → recompute. Conference-to-conference rollups (env+/Stuff+/HTP) feed the TRANSFER levers (deferred with transfer).

---

## STEP 2 — ncaa_averages + compute_scores (2026-08-20)

**Step 2a `ncaa_averages`** (`src/lib/computeNcaaAverages.ts`): reads Hitter/Pitching Master (D1), writes `ncaa_averages` (upsert on season). Mean = **PA/IP-weighted full population**; SD = **unweighted QUALIFIED only** (AB≥75 / IP≥25), sample SD (÷n−1). Stuff+ separate (pitch-count-weighted from `pitcher_stuff_plus_inputs`).

**Step 2b `compute_scores`** (`src/lib/computeAndStoreScores.ts`): stage 1 `*_score = scoreFromNormal(metric, ncaa_mean, ncaa_sd)` (CDF·100, inverted for lower-better); stage 2 composites `/50·100` → `*_power_rating`. Reads Masters + `ncaa_averages`; writes `*_score`+`*_power_rating` BACK to the Masters. **`obp_power_rating` = the `from_obp_plus` the returner SD-blend consumes.** Already audited clean (stored `*_pr_plus` reproduce from scores Δ<0.01).

**⭐ `*_pr_plus` columns ALREADY EXIST on the Masters** — NOT created. Pitching Master: `era_pr_plus…hr9_pr_plus, overall_pr_plus`. Hitter Master: `ba/obp/iso_power_rating, overall_power_rating`. compute_scores `.update()`s these existing cols.

**FIX — pitcher exit-velo/in-zone (`computeNcaaAverages.ts`):**
- `pitcher_exit_velo` + `pitcher_ev90` (mean AND sd) **pinned = the hitter `exit_velo`/`ev90` 1-for-1** — exit velo is one number per batted ball, identical by side. Was: `pitcher_exit_velo` NULL, `pitcher_ev90` mapped from `90th_vel` = **90.41 ≠ hitter ev90 101.47** (WRONG).
- `pitcher_in_zone_pct` **added to the map** (from `Pitching Master.in_zone_pct`, pitch-log-populated) — genuinely pitcher-specific. Dry-run: 47.94 (was NULL).
- Dry-run verified 2026-08-20.

**⚠ `Pitching Master.90th_vel` = FASTBALL VELOCITY, not exit velo** (stored 90.41 ≈ 90 mph FB, not the 101 exit-velo). Never use `90th_vel` for `pitcher_ev90`. Exit-velo metrics come from pitch-log batted balls only.

**🔴 TWO OPEN DECISIONS (Trevor 2026-08-20):**
1. **NCAA averages are stored in BOTH `ncaa_averages` TABLE and `model_config`** (`p_ncaa_avg_*` pitcher-scoring copies + `r_/t_*_ncaa_avg`/`*_std_ncaa` returner/transfer). `computeAndStoreScores` reads the TABLE; app live paths read `model_config`. **The exit-velo/in-zone fix must sync BOTH** (`model_config.p_ncaa_avg_avg_ev/ev90/in_zone_pct`) or they drift. Store-everything consistency.
2. **"One metric across the population, from the pitch log"** (Trevor's directive): every tracked metric should be computed ONCE from the raw pitch log (true population), fill both hitter+pitcher, **except Stuff+**. Population avg exit velo from pitch log = **86.61** (336,732 D1 balls) vs Master-per-player 85.93. Building `ncaa_averages` from the pitch-log population (not Master per-player columns) shifts baselines → **re-scores everyone** (part of recalibration, a modeling change). SCOPE PENDING.

**RESOLVED (Trevor 2026-08-20):**
- **Decision 1 — dual-write DONE.** `computeNcaaAverages` now writes mean AND SD to BOTH `ncaa_averages` and `model_config` (`buildModelConfigRows(updates, season)` — reads the same `updates` object → identical by construction, no drift). **Key-naming catch: pitcher SD reader convention is `p_sd_*` (e.g. `p_sd_avg_ev`, `p_sd_ev90`, `p_sd_in_zone_pct`), NOT `p_ncaa_sd_*`** — matched to `pitcherProjection.ts`/`loadPitchingPowerEq`. 40 rows dry-run verified (p_sd_avg_ev 4.31, p_sd_ev90 3.89, p_sd_in_zone_pct 5.79 = the ncaa `_sd`). `wrc_sd` unused (wRC+ is a ratio) → left null. `r_iso_std_ncaa` written for completeness (no current reader). Power-rating baselines / `*_std_pr` / wrc-scale constant intentionally NOT written (not population means). Ideal = one store; deferred (model_config has many reads).
- **Decision 2 — "one metric":** Trevor's point = pitching + hitting share ONE ncaa exit-velo average (the pin), not a population-math change. Pitch log = source of truth (Masters pitch-log-fed). No re-scoring shift needed.
- **Step 2b compute_scores VERIFIED live:** Brett Ott `ba_power_rating` 124.1/124.12, Grayson Ashe 143.3/143.25 — `scoreFromNormal → *_score → composite/50·100 → *_power_rating` reproduces stored to ~0.02.
- **STEP 2 COMPLETE.** NEXT: Step 3 `create_predictions` (Masters → `player_predictions` `from_*`/`from_*_plus`) → Step 4 recompute (edge-fn returner rebuild, 13 steps).

---

## STEP 3 — create_predictions (2026-08-20) — REAL BUG FOUND + FIXED

**Source→dest:** `createPredictionsFromMaster.ts` reads Hitter/Pitching Master (rates + `*_power_rating`/`*_pr_plus` + `blended_*`), writes `player_predictions` `model_type='returner' variant='regular'` **`season = PROJECTION_SEASON` (2027)** — 2026 actuals → 2027 returner predictions.

**🔴 BUG (fixed):** the per-stat `from_avg_plus`/`from_obp_plus`/`from_slg_plus` were **read** (`ba/obp/iso_power_rating`, lines 151-153) but **never written** — only the *overall* `power_rating_plus`. The only writer of `from_*_plus` was the legacy `google-sheets-sync`. So in the Master→predictions pipeline `from_obp_plus` was **NULL** — yet the returner **SD-blend reads `from_obp_plus`** (`predictionEngine.ts:584`, edge `recalculate-prediction:125`). Returner could only fall back to the overall rating for every stat (the exact defect flagged in the edge-fn rebuild). **FIX:** write `from_avg_plus=ba_power_rating, from_obp_plus=obp_power_rating, from_slg_plus=iso_power_rating` on BOTH new-insert and update paths; broadened the update guard to `|| existing.from_obp_plus == null` so existing (non-blended) rows backfill on re-run. Blend-safe: those ratings are already blend-aware (compute_scores uses `blended_*` for `combined_used`).

**Trevor:** overall power rating is NOT used in projections (only OPR/offensive + `_pr_plus` matter) → projection now correctly keyed on the **per-stat** `from_*_plus`. Pitchers read `era_pr_plus` etc. from the Master directly (no player_predictions per-stat column — no gap there). JUCO out of scope.

---

## STEP 4 — RECOMPUTE (the projection engine) — comprehensive (2026-08-20)

**Runs today across 3 FRAGMENTED paths (different models, different places):**
- **Returner HITTERS** → `recalc()` in `recalculate-prediction` edge fn (`action:'bulk_recalculate'`) — **multiplicative, SD-FREE model. WRONG.**
- **Returner PITCHERS** → `computePitcherProjection` in `precompute-returner-pitchers.ts` (SCRIPT) — **SD-blend, CORRECT** (reads pitchingEquations incl. whip_pr_sd), but it's a script not the edge fn.
- **Transfer (H+P)** → `recalcTransfer` / `process-precompute-jobs` edge fn — deferred (equation unsettled).
→ The two returner sides run DIFFERENT models in DIFFERENT places. That asymmetry is the headline.

**The loop:** trigger (admin button/cascade) → fetch all active returner+transfer preds → batches of 50 → `recalc`(returner)|`recalcTransfer`(transfer) → unlock→update `p_*`→re-lock.

**Returner-hitter: current vs target** (player from_obp 0.415 prPlus 88 JS → stored p_obp 0.407, p_wrc 0.380, p_wrc+ 100):
- Current `recalc` (multiplicative, NO intercept) → wRC+ **98**, AVG/SLG off.
- Target SD-blend `ScaledOBP=r_ncaa_avg_obp + ((from_obp_plus−100)/r_obp_std_pr)×r_obp_std_ncaa` → blend → `×(1+ClassAdj+DevAgg·0.06)`, wRC `+0.011` → wRC+ **100**. NOW RUNNABLE (Step 3 wired from_obp_plus; Step 2 stored r_obp_std_pr/r_obp_std_ncaa in model_config).

**SHORTCOMINGS:** (1) wrong returner-hitter model — multiplicative, no SD, no intercept, divisor damp not tiered, overall not per-stat; (2) reads model_config wrong (returner filter → 0 rows → hardcoded); (3) 3 drifted math copies; (4) returner pitchers = script, not autonomous-on-upload; (5) dead `bulkRecalc`/`fetchAllPredictionsForReturnerMode` ReferenceError; (6) edge pitcher IP drift (transfer); (7) no true run-on-upload.

**⭐ NORTH STAR (Trevor): ONE edge function**, autonomous on upload: ingest → derive both Masters (Step 1) → ncaa_averages+model_config (Step 2a) → compute_scores (Step 2b) → create_predictions (Step 3) → recompute returner H+P on SD-blend reading model_config (Step 4) → [transfer once settled]. Every fixed step is a module that folds into that single function — kills fragmentation, script/edge split, dead code, model ambiguity. THIS is the best learning-data build; keep logging comprehensively.

---

## STEPS 1–3 APPLIED TO STAGING + VERIFIED (2026-08-20)

Ran in order (Trevor: apply 1-3, verify stores properly, THEN build Step 4):
- **Step 1** `derive_masters_from_pitchlog.ts --apply --no-newrows` — Masters pitch-log-fed. 4374 hitters / 4772 pitchers. **Bug hit + fixed:** batch upsert "ON CONFLICT cannot affect row a second time" → added dedupe by (source_player_id, Season) + null-id skip in `upsertBatch`. Re-ran clean (no dups dropped — first failure was a partial-state fluke). Verified: Gidley AVG 0.325→0.326, O'Harran K9 7.65, in_zone_pct populated, ERA untouched (TruMedia).
- **Stuff+**: confirmed current (audited v1-anchor); `Master.stuff_plus` already = totals' pitch-weighted per-pitch Stuff+ (verified to 0.01). Logged as explicit rollup step (runbook G0) before compute_scores.
- **2a** `computeAndStoreNcaaAverages(2026)` — exit_velo 86.22 = pitcher_exit_velo (1-for-1), ev90 101.45 = pitcher_ev90 (1-for-1), pitcher_in_zone_pct 48.33 (was null). model_config mirror: p_sd_avg_ev 4.19 / p_ncaa_avg_avg_ev 86.22 written, **unique per (admin_ui,2026,key)** (the "two values" seen were 2025-vs-2026 seasons, not dups).
- **2b** `computeAndStoreAllScores(2026)` — 8246 hitters / 8072 pitchers scored (1 hitter error). `*_power_rating` refreshed on the pitch-log Masters + new baselines.
- **3** `createPredictionsFromMaster(2026→2027)` — 9600 predictions, 0 errors, 6:20 runtime. **from_obp_plus now populated on 5127 returner rows** (was NULL — the SD-blend input).

**⚠ SHORTCOMING (log for the unified edge fn):** `createPredictions` applies the ~8195 stub updates **one row at a time** (`for (const u of predsToUpdate) await supabase.update(...)`, `:343`) → 6+ min, silent (no per-row log — an output-gap watchdog false-alarms). BATCH this in the unified fn.

**STATE:** Steps 1-3 clean on staging. Ready to BUILD Step 4 (edge-fn returner rebuild) — all its inputs now correct (from_obp_plus populated, model_config r_*/p_sd_* current, scores refreshed).

---

## STEP 4 BUILD — the correct SD-blend ALREADY EXISTS in code (2026-08-20)

**⭐ The canonical `predictionEngine.ts:528-575` `recalc()` IS the correct SD-blend** (Trevor's intended returner-hitter model), fully done:
- `pAvg`: `scaledBa = ncaaAvg + ((baPlus−ncaaPR)/baStdPower)×baStdNcaa` → `blend(fromAvg, PRw)` → `×(1 + bases.avg + devAgg·devCoeffs.avg)`
- `pObp`: same with obp params (= Trevor's ScaledOBP)
- `pIso`: `lastIso = fromSlg−fromAvg` → `scaledIso via isoStdPower/isoStdNcaa` → blend → `×(1+bases.iso+…)` ⇒ **SLG = pAvg + pIso** (resolves "no r_slg_std" — SLG rides ISO)
- `pWrc = 0.011 + 0.691·pObp + 0.235·pSlg` (intercept present); `pWrcPlus = pWrc/ncaaWrc·100`
- `baPlus/obpPlus/isoPlus` = the per-stat ratings (now `from_*_plus`, populated by Step 3)

**The `recalculate-prediction` EDGE fn just carries the WRONG multiplicative copy of `recalc`.** So STEP 4 = **PORT `predictionEngine.recalc` (the correct SD-blend) into the edge fn** + wire it to READ `model_config` `r_*` (fix the `model_type='returner'`→0-rows + bare-key bugs; predictionEngine's hardcoded defaults happen to match the stored r_* so its MATH is right regardless — but the edge must read the DB per store-everything). Then delete dead `bulkRecalc`/`fetchAllPredictionsForReturnerMode`. Verify by hand-computing the SD-blend for a real player vs the ported edge recalc (dry-run). Pitchers: `precompute-returner-pitchers.ts` already correct (SD-based) — fold into the edge fn later. D1 only.

---

## STEP 4 — post-build findings + 4 flags (2026-08-20)

**Built + VERIFIED:** edge `recalc()` = SD-blend port of `predictionEngine.recalcReturner`, reads `model_config` `r_*` (admin_ui, season 2026). Hand-vs-ported MATCH exact on 3 real players; returner wRC+ shifts DOWN ~2-4 pts off the wrong multiplicative (100→97, 92→90, 73→69) — modest.

**A — LIVE returner path is DEAD.** `recalcReturner ← calculatePrediction`, and `calculatePrediction` has NO callers (bulkRecalc now a stub → edge fn; PlayerProfile/TeamBuilder retired `recalculatePredictionById` → read stored; TB sim uses the *transfer* `t_obp_std_pr`). **KEPT as the canonical SD-blend reference (marked reference-not-runtime, `predictionEngine.ts:659`)** — Trevor "might be worth saving." Git has it regardless.

**B — pitcher bulk NOT in the edge fn.** Returner pitchers = `precompute-returner-pitchers.ts` (correct, SD-based `computePitcherProjection`) — a script. Fix = port it into the edge fn's `bulk_recalculate` (real Deno port of computePitcherProjection: SD-blend rates + D1-FIP/pRV+/pWAR + market + role transition + depth-role IP). For the RUN now the script works; port is the consolidation.

**C — `isoStdPower`:** only `t_iso_std_power`=45.423 exists (both seasons), no `r_` variant. Fix = add `r_iso_std_power` + point returner at it (edge fn currently falls back to `t_iso_std_power`).

**D — ⭐ CRITICAL: `std_pr` constants are STALE post-recalibration.** Step 2b recomputed all power ratings on the new pitch-log Masters → the SD constants no longer match: `r_ba_std_pr` 31.297 vs actual **29.99**; `r_obp_std_pr` 28.889 vs actual **31.89** (~10% off); `iso` 45.42 vs 44.91. The edge-fn returner SD-blend reads `r_obp_std_pr=28.889` → **mis-scaled power adjustment**. **MUST re-measure ALL `std_pr` (hitter ba/obp/iso + pitcher era/fip/whip/k9/bb9/hr9 incl. the whip 24.59→~37 fix) on the CURRENT ratings and update model_config (`r_*`, `t_*`) + code defaults BEFORE running Step 4.** This is the SD-fix thread finalized on the post-recalibration ratings.

**ORDER before Step 4 run:** (D) re-measure + store std_pr → (C) add r_iso_std_power → (B) pitcher port (or run script) → run returner recompute. Deploy edge fn to staging to run it.

---

## STEP 4 RUN + SPOT-CHECK (2026-08-20) — full pipeline applied on staging

**Applied:** D (std_pr → model_config + code defaults, committed) → returner-hitter recompute (`precompute-returner-hitters` = recalcReturner SD-blend, 8234 updated, 1 error) → returner-pitcher recompute (`precompute-returner-pitchers`, done). Batch runs via the SCRIPTS (both use the correct SD-blend + D's SDs) — **no edge-fn deploy needed for the batch.** recalcReturner CONFIRMED NOT DEAD (it IS `precompute-returner-hitters`); only `calculatePrediction` deleted.

**Spot-check staging (recalibrated) vs PROD (current), 2027 returner, keyed by source_player_id** (player_id is per-env UUID — DON'T join on it):
- Shift is BIMODAL: median wRC+ ~5, oWAR ~0.29, pWAR ~0.08, hitter market ~$4.5k (D1-only); dWAR/bsrWAR ~0.001 (destination-invariant, from Master). Most players barely move.
- **⭐ The big movers are the SMALL-SAMPLE BLEND, not the SD impact.** Traced Cael Boever wRC+ 37→107: 9-PA player, `combined_used`=false on prod (projected off 0/0/0 actuals → garbage 37) vs true on staging (blended prior-year .35/.45/.40 + from_*_plus populated → sensible 107). So the recalibration FIXED tiny-sample garbage projections. To see the PURE SD/power-rating impact, filter `combined_used=false` + PA≥75 (drops the blend churn). The SD-blend itself is the modest-median tier.
- Full WAR/market chain confirmed FILLED (stats → o/d/bsr → total_hitter_war → market).
- Trevor's JUCO guess: mostly D1 (only Ryan Piekutoski of the samples was NJCAA_D1); the big wRC+/AVG/market movers are D1 small-sample blends.

**Full pipeline handoff:** `docs/HANDOFF_war_recalibration_pipeline_2026_08_20.md` — every step in run order + findings + next steps + deferred.

---

## TRANSFER LEVER FINALIZATION + GO-FORWARD PLAN (2026-08-20) — pointer
Full tables + analysis: `docs/HANDOFF_team_season_stats_2026_08_19.md` §"TRANSFER LEVER FINALIZATION" and §"TRANSFER LEVER DISPLAY + GO-FORWARD PLAN". Memory: [[project_war_pitchlog_to_prod_plan]], [[project_transfer_lever_finalization]].

**Non-obvious learnings:**
- **JUCO contamination trap:** `Conference Stats` 2026 has 42 rows; 10 `NJCAA D1 … District` rows are mislabeled `division='D1'` (FIP 6.4–8.0). Filtering `division='D1'` gives 40 → inflated SDs (I hit this: fip+ 20.94 instead of 6.78). Clean D1 = 30 (exclude `conference abbreviation LIKE 'NJCAA%'`). Applies on BOTH prod + staging. Cross-check any conf SD against the definitive audit (era+ 7.30 z×20) to catch it.
- **Pitcher conf weights ARE 0.025×SD** (era .235=.025×9.4, hr9 .433=.025×17.3 from OLD comment SDs) — so updating the SD auto-updates the weight; the methodology amplifies high-SD metrics (impact ∝ SD² when weight=0.025·SD). This is why hr9 balloons on the ratio.
- **Ratio inflates small-denominator rates:** hr9 ratio SD 23.38 vs z×20 10.14 (avg only 1.12). But it's REAL spread (winsorized 18.57), and it DOUBLE-COUNTS HTP (high-HR9 confs = power confs = better hitters, which HTP already prices). Same "Ivy double-count" as the HTP→park-factor work.
- **Run chain gates which levers matter:** only OBP+SLG→wRC+ (hitter) and K9/BB9/HR9→pRV+ (pitcher) create runs. ERA/FIP/WHIP conf + park levers move DISPLAYED rates but 0 runs/WAR. So HR9 is the only pitcher park lever that touches WAR.
- **Park is per-TEAM per-metric** (`Park Factors`, 308 D1), `whip_factor`==`obp_factor`, `hr9_factor`==`iso_factor`; pitcher park OFF (weight 0). Mapping DECIDED: ERA/FIP→RG, WHIP→OBP, HR9→ISO, none K9/BB9; add `era_factor`/`fip_factor`=`rg_factor`.
- **Method discipline that worked:** validate any new SD computation by reproducing the prior-audit number on the same scale before trusting the new-scale number.
# HTP PARK-FACTOR SWAP — NOT APPLIED (2026-08-21)
The 08-13 HTP swap `(100−wRC+)`→conference park factor was NEVER built. All sites still use `OPR + 1.25·(Stuff+−100) + 0.75·(100−wRC+)`; no `wrc_park` in code. Formula duplicated ~8 sites (precompute-pitchers.ts:174 feeds projections; TeamBuilder:826; TransferPortal:504; PitcherProfile ×3; PitcherPage:282; ConferenceStatsPage:162; PitchingConferenceStatsTable:82; playerRisk:875). Stored hitter_talent_plus reflects the old formula. MUST centralize + swap + recompute BEFORE storing HTP (Step 4), else the old formula is baked into stored values. Detail: HANDOFF_team_season_stats_2026_08_19.md §HTP PARK-FACTOR SWAP.

---

## STEP 1 BUILD — env+ ratio + weights (2026-08-21) — non-obvious learnings
Detail: `HANDOFF_team_season_stats_2026_08_19.md` §STEP 1. Memory: [[project_transfer_lever_finalization]].

- **⭐ D1 vs JUCO transfer weights — do NOT conflate (cost real time):** `transferWeightDefaults.ts` `transfer_*` block = **JUCO_PITCHING_TRANSFER_WEIGHTS** (0.235/1.0/0). The **D1 pitcher** transfer weights = `pitchingEquations.ts DEFAULT_PITCHING_WEIGHTS` (conf 0.3/k9 0.4, competition 0.5, park 0.075/0.15/0.05); **D1 hitter** = `TRANSFER_WEIGHT_DEFAULTS` (0.30/0.30/0.15, pitching 1.00/0.85/0.75, park 0.24/0.26/0.11). I built a whole run-impact table on the JUCO weights before catching it. Always confirm which weight object the equation actually reads for the division in question.
- **⭐ model_config columns are `config_key`/`config_value`** (NOT `key`/`value`), model_type='admin_ui', unique on (model_type, season, config_key). A `.ilike("key",…)` query silently returns 0 — that's a wrong-column bug, not "not stored." Same family as Conference Stats `"Season"` vs `season`.
- **⭐ Hitter t_* transfer weights EXIST in model_config (old values) and OVERRIDE code defaults** (readEquationValue reads model_config first). So changing `TRANSFER_WEIGHT_DEFAULTS` alone is INERT for anything reading model_config — must UPDATE model_config. Pitcher transfer_* were ABSENT → code default used (my pitcher code change took effect; hitter needed the DB update).
- **Park is already fully wired** — `parkFactors.ts:60` maps `era→rg_factor`; `transferPitcherProjection.ts:378` feeds FIP the SAME `fromRg/toRg`. So ERA+FIP park both read rg_factor with no new columns; whip→whip_factor, hr9→hr9_factor. My "needs era_factor/fip_factor columns" claim was WRONG — verified by reading the projection call. `ParkMetric` has no "fip" because fip reuses era/rg.
- **%impact math:** displayed % = weight × SD (since env+ is /100 and 1 SD = SD index points). So weight = target% ÷ SD. Used to set every lever to a target.
- **Dead-code discipline (Trevor):** displays read stored values; any live-compute/fallback for a stored quantity is dead code → remove. Verified dead via grep-zero-refs + `npm run build` (not just tsc), and confirmed the *other* same-named helper (TB hitter `/50*100` toPlus) was untouched.
- **JUCO isolation:** D1 env+ reads stored ratio; JUCO districts have NULL stored env+ → resolve null and are skipped (blocked). JUCO gets its own function later (Trevor: "separate the 2 functions").

---
## TRANSFER EQUATION LINEAGE — verified findings (2026-08-21)
Full spec: `docs/TRANSFER_EQUATION_LINEAGE_2026_08_21.md`. Non-obvious:
- **Hitter env+ ≠ pitcher env+ provenance.** Pitcher reads STORED `era_plus…hr9_plus` (ratio); hitter computes env+ LIVE from hardcoded divisors `AVG/0.280 · OBP/0.385 · ISO/0.162` (`precompute-transfer-projections.ts:155-157`), ignoring the stored `ba_plus/obp_plus/iso_plus`. The 1a–1d stored-conversion was pitcher-only. Fix hitter to read stored before re-run.
- **`readPitchingWeights` (pitcher batch) reads code DEFAULT_PITCHING_WEIGHTS**, NOT model_config — via `loadEquationWeightsMap(2025)` ("Equation Weights" table, verified **EMPTY**) + localStorage (undefined in Node). So pitcher code weight edits DO take effect; the model_config `transfer_*` mirror is consumed only by the Deno edge fn. Hitter batch DOES read model_config (`t_*`) — hence the earlier "must update model_config" catch was hitter-specific.
- **Hitter from-team = NAME-only key** (`:329`), pitcher = id-first (PM TeamID→players.team_id→name). Hitter blocks when the name doesn't normalize even with a team_id present — an IDs-over-names bug ([[feedback_id_over_name]]).
- Conference resolve (both): conference_id → JUCO district-id map → name alias. Handedness: hitter park lhb/rhb splits (avg/obp/iso); pitcher combined only. Depth role: hitter PA tier (stored projected_pa = tier, not raw); pitcher regular_season_ip→depth role→pitcherExpectedIp (canonical rewrite overwrites coarse first pass).

---
## NEW-TEAM PRECOMPUTE PATH = the edge fn (2026-08-21) — don't forget on prod
When a customer team is added: AFTER INSERT trigger on `customer_teams` → `precompute_jobs` row → `process-precompute-jobs` edge fn (`runPrecomputeForTeam`). This is a THIRD copy of the transfer math (batch / edge fn / TB), and it silently drifts. It had: hitter env+ live (`AVG/0.280`), name-only from-team, hardcoded D1 pitcher weights — all now fixed to match the batch (stored `ba/obp/iso_plus`; id-first via `source_team_id`; model_config `transfer_*` overlay onto `eqD1`). Hitter weights already used model_config (readEquationValue + remoteEquationValues load at index.ts:961); pitcher env+ already read stored `era_plus`.
**Lesson:** any transfer-logic change must be mirrored in ALL THREE copies (batch scripts, `process-precompute-jobs` edge fn, TB live hook) until the unified edge fn (Track B) collapses them. The edge fn is the NEW-TEAM path — a change that only touches the batch leaves new teams on old logic. Prod push MUST redeploy the edge fn (runbook Part H).

---
## SNAPSHOT REFRESH — the "automatic function" + its DATA-INTEGRITY protections (2026-08-21)
After ANY projection change, saved-build + target snapshots must refresh WITHOUT changing toggles, and MUST pull the correct team-scoped line. Two-step: (1) `backfill-neutral-snapshot.ts` refreshes `neutral_snapshot` from current predictions; (2) `heal-stale-snapshots.ts` re-derives `player_snapshot`/`transfer_snapshot = projectEffectiveWar(new neutral, production_notes)`. Toggles (`production_notes`) never written.

**⭐ THE PREDICTION-SELECTION PROTECTIONS (why it never pulls the wrong data):**
- **Team-scope filter FIRST:** `pick()` filters `preds` to `customer_team_id == null || === ctid` — **other teams' predictions are excluded BEFORE selection**, so even the last-resort fallback can only land on a global or this-team row. NEVER another team's precompute (the historical "returner-snapshot blend bug" = grabbing whichever team's precompute sorted first; killed by this filter).
- **Precedence:** this-team `precomputed` (transfer) → global `regular` (returner) → safe-bounded fallback. A returner has no same-team precompute → correctly falls to the global regular line. `backfill-build-snapshots` mirrors this via `predRank` (this-team-precomputed=3 > global-regular=2 > other=1).
- **Season + status gates:** `season=2027`, `variant in (regular, precomputed)`, `status in (active, departed)`.
- **RLS (runtime):** reads are program-scoped by `customer_team_id` (team_builds → team_build_players; player_predictions) per [[reference_rls_scoping]] — a coach only ever reads their own team's snapshot/predictions. Scripts run service-role (bypass RLS) but select team-scoped in code; the DISPLAY path is RLS-enforced.
- **VERIFIED:** 40/40 Georgia build players matched this-team-precompute-or-global-regular WAR (≤0.03), zero cross-team leakage.

**Consistency mandate (Trevor):** wherever a value is displayed it must be accurate + consistent. Every display reads the STORED snapshot/prediction (no live compute) → same number everywhere. The unified edge fn (Track B) MUST replicate these exact selection protections when it refreshes snapshots on upload.

---
## CONFERENCE STATS BUILD PROCESS — mapped (2026-08-21) — see `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`
Conference Stats (feeds transfers) is filled by ~6 disconnected producers; **several populated columns have NO committed producer** (hand-run SQL → won't reproduce on prod): WRC_plus (commented assembly SQL only), hitter_talent_plus/HTP (no committed writer), run_env_factor (no writer at all), offensive_power_rating/OPR (0/30, dead Savant caller), raw rates (canonical pitch-log assembly UPDATE commented out). ⚠ PROD-PUSH RISK — must codify. Canonical HTP (decided): `OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor)` (park swap), OPR=`offensive_power_rating` (0.15ba+/0.4obp+/0.45iso+), STORED + read (no live compute). Full producer map + edge-fn conf-stats-derive spec in the dedicated doc.
