# HANDOFF — WAR Recalibration Pipeline (pitch-log-primary) — 2026-08-20
> ⚠️ **STUFF+ CONTENT IN THIS FILE IS SUPERSEDED — see `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` (2026-08-30).**
> The rest of this document may still be valid; only its Stuff+/reclassification statements are out of date:
> • **LIVE lane = pitch_log**: `pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus`
>   → `aggregate_pitch_log_dimensions.ts` → totals/by_pitch_type. ⛔ `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline`
>   → `legacy_rollupStuffPlusToMaster` is **LEGACY** (≤2025 + JUCO only) and scores **left-handers BACKWARDS** on 2026.
> • Classifier = `src/savant/lib/stuffPlusClassifierV2.ts` @ **95.2% per-pitch / 95.3% arsenal-mix**. Any 92.6% / 94.3% /
>   95.1% / "~85%" figure here is superseded.
> • `breakingBallReclassification.ts` → renamed **`legacy_breakingBallReclassification.ts`**; `rollupStuffPlusToMaster.ts`
>   → **`legacy_rollupStuffPlusToMaster.ts`**. DELETED: `reclassify_pitch_log.ts`, `_run_reclassify_{bare,chunked}.ts`,
>   `_reclass_rollout.ts`, `ReclassificationRunner/StuffPlusRunner/StuffPlusRollupRunner.tsx` (+ npm `reclassify-pitch-log*`,
>   `recompute-stuff:prod`, `recompute-stuff-scoped:prod`). `reclassify_anchor_prod.ts` never existed — it is `reclassify_prod.ts`.
> • Step 4 on PROD **must** use `--direct` (gateway cuts at ~125s; `vs_top_hitters` needs 253s).


**Status:** the full recalibration pipeline is BUILT and APPLIED ON STAGING (D1 only, 2026 data → 2027 projections), verified vs prod. NOT on prod. Companion docs: `AGENT_LEARNINGS_war_recalibration_audit_2026_08_20.md` (findings), `AUDIT_war_recalibration_state.md` (branch audit), `PROD_PUSH_RUNBOOK_war_recalibration.md` (prod steps).

---

## THE PIPELINE (every step, in run order) — "pitch log → projections"

The north star (Trevor): ONE edge function, autonomous on upload, running the whole chain. Today it's built as modules (scripts/functions) all wired into `scripts/recompute-cascade.ts`. Each step below is applied on staging.

### STEP 0 — Stuff+ (input to pitcher power ratings)
`recompute-stuff-plus.ts` = reclassify pitch types → per-pitch Stuff+ (z vs D1 baseline) → `rollupStuffPlusToMaster`. Stuff+ was fully audited + is current (v1-anchor). Step 1's derive already set `Master.stuff_plus` from the totals' pitch-weighted per-pitch Stuff+ (verified to 0.01). MUST precede compute_scores (Stuff+ feeds k9⁺/era⁺/whip⁺). Runbook G0.

### STEP 1 — Pitch log → BOTH Masters (`scripts/derive_masters_from_pitchlog.ts`)
The pivot: pitch log becomes the primary source. Reads `pitch_log_hitter_totals`/`pitch_log_pitcher_totals` (dim 'all', D1), derives the full stat line via `src/savant/lib/pitchLogRates.ts`, UPSERTs into `Hitter Master` + `Pitching Master` (keyed source_player_id, Season). TruMedia Master = sporadic fill/override (null/thin → keep Master). Creates new rows for pitch-log-only players (2027).
- Hitter: AVG/OBP/SLG/ISO (rates) + scouting (contact/barrel/EV/etc, ×100 to Master's 0-100 scale).
- Pitcher: scouting + **K9/BB9/HR9/WHIP/FIP** — via **per-pitcher IP** (see below). ERA/IP/G/GS/Role stay TruMedia.
- **Per-pitcher IP** = out-attribution (outs on a PA = next PA start-outs − this start; last PA = max(outs)+1 − start; credited to that PA's pitcher). Migration added `pitch_log_pitcher_totals.ip`. Validated corr 0.9995 vs Master IP; K9/BB9/WHIP 0.996+.
- **FIP = descriptive classic** `(13·HR + 3·(BB+HBP) − 2·K)/IP + 3.157` (matches Master to ~0.01). NOT `computeProjFip` (that's the projection/pWAR FIP — a different column).
- Schema: added UNIQUE `(source_player_id, Season)` on both Masters (was missing). Dedupe safety in upsertBatch.
- APPLIED: 4374 hitters / 4772 pitchers. Verified (Gidley AVG 0.325→0.326; O'Harran K9 7.65, in_zone_pct populated, ERA untouched).

### STEP 2a — `ncaa_averages` (`src/lib/computeNcaaAverages.ts`)
Reads D1 Masters → writes `ncaa_averages` (means PA/IP-weighted; SDs qualified-only AB≥75/IP≥25). **FIX:** `pitcher_exit_velo`/`pitcher_ev90` (mean+sd) were NULL/wrong (`90th_vel` = fastball velo, not exit velo) → now **pinned = the hitter `exit_velo`/`ev90` 1-for-1** (exit velo is one number per batted ball; compute once, fill both). `pitcher_in_zone_pct` added to the map (pitch-log source). **DUAL-WRITE:** now writes mean AND SD to BOTH `ncaa_averages` AND `model_config` (`buildModelConfigRows`, keys `p_ncaa_avg_*`/`p_sd_*`/`r_*`/`t_*`) — identical by construction, no drift. APPLIED (exit_velo 86.22, in_zone 48.33).

### STEP 2b — `compute_scores` (`src/lib/computeAndStoreScores.ts`)
Master metrics + ncaa_averages → `*_score` = `scoreFromNormal(metric, mean, sd)` → composites `/50·100` → `*_power_rating` written BACK to Masters. `obp_power_rating` = the `from_obp_plus` the returner SD-blend consumes. APPLIED: 8246 hitters / 8072 pitchers. Verified (Ott ba_power_rating 124.12, Ashe 143.25 reproduce).

### STEP 3 — `create_predictions` (`src/lib/createPredictionsFromMaster.ts`)
Masters → `player_predictions` (returner, regular, **season 2027** — 2026 actuals project to 2027). **BUG FIXED:** the per-stat `from_avg_plus/from_obp_plus/from_slg_plus` were READ but never WRITTEN (only overall `power_rating_plus`) — so `from_obp_plus` (the returner SD-blend's `OBPPowerRating+`) was NULL in the whole pipeline. Now written on insert + update; guard broadened to fire on `from_obp_plus==null` so existing rows backfill. Small-sample blend (`combined_used`) uses `blended_*`. APPLIED: from_obp_plus populated on 5127 rows.

### STEP D — `std_pr` (`src/lib/computeStdPr.ts`, NEW, wired into cascade)
Measures the power-rating SDs on the CURRENT ratings (PA≥60 hitters / IP≥40 pitchers) → writes `model_config` (`r_*/t_*_std_pr`, `r_iso_std_power` NEW, `p_*_pr_sd` mirror) + code defaults. **These were stale after 2b recomputed the ratings** — the returner SD-blend divides by `r_obp_std_pr`. Re-measured: `r_obp_std_pr` 28.889→**31.895**; `whip_pr_sd` 24.586→**37.198** (the composite-refit fix, on final ratings); ba 30.0, iso 44.9, era 28.1, fip 22.9, k9 45.5, bb9 42.9, hr9 32.3. Wired into `recompute-cascade` after compute_scores so SDs never go stale again. k9/bb9 lock-in updated (Trevor: no reason to freeze). APPLIED to model_config.

### STEP 4 — Returner recompute (THE projection)
**The returner-hitter model:** `predictionEngine.recalcReturner` = the CORRECT SD-blend: `scaled = ncaaX + ((Plus−100)/std_pr)×std_ncaa` (per-stat `from_*_plus`) → `blend = from×(1−0.7)+scaled×0.7` → `×(1+classBase+devAgg·devCoeff)`; SLG rides ISO; `pWrc = 0.011 + 0.691·pObp + 0.235·pSlg`.
- **Batch run = the SCRIPTS** (both use the correct SD-blend + D's SDs): `precompute-returner-hitters` (= `backfill-2027-hitter-returners.ts` → recalcReturner, powerContext from Master ba/obp/iso_power_rating) + `precompute-returner-pitchers.ts` (computePitcherProjection). APPLIED: hitters 8234 updated (1 error), pitchers done.
- **Edge fn `recalculate-prediction`** = the on-demand/admin path — its `recalc()` was the WRONG multiplicative model (no SD, no intercept, divisor damp, overall not per-stat). REBUILT to port recalcReturner + read `model_config` `r_*` (fixed the `model_type='returner'`→0-rows + bare-key bugs). Committed but NOT deployed (batch uses scripts).
- **Fills the full chain:** projected stats → `o_war` + `d_war`/`bsr_war` (from Master, destination-invariant) + `total_hitter_war` (o+d+bsr) + `market_value`. Pitchers: p_era…p_hr9 + p_rv_plus + p_war + market.

---

## KEY FINDINGS / DECISIONS (this session)

1. **The old returner-hitter model was WRONG the whole time** (edge fn): multiplicative, no SD term, no wRC intercept, divisor damp, used overall rating not per-stat. The SD-blend (`recalcReturner`) was always the intended model. (Trevor: "not one we can change... coaches used this.") Modest shift for most.
2. **Composite-WAR / market chain** IS filled by the returner recompute (o+d+bsr → total; market from total, movement via oWAR since d/bsr are destination-invariant).
3. **Spot-check staging vs prod (2027 returner):** shift is BIMODAL — median wRC+ ~5 / oWAR ~0.29 / pWAR ~0.08 (most players barely move), tail large. dWAR/bsrWAR ~unchanged.
4. **⭐ The big movers are NOT the SD impact — they're the small-sample blend.** Traced Cael Boever (wRC+ 37→107): 9-PA player, `combined_used` false on prod (projected off 0/0/0 → garbage 37) vs true on staging (blended prior-year .35/.45/.40 → sensible 107). So the recalibration FIXED tiny-sample garbage projections. The PURE SD/power-rating impact is the modest median tier; to isolate it, filter to `combined_used=false` + PA≥75.
5. **Everything stores in the DB** (Trevor's directive): ncaa means/SDs + power-rating SDs now in `model_config` (mirror) as well as code. Edge fns read model_config for hitter std_pr (future-proof); pitcher pr_sd in the transfer edge fn is hardcoded (stale until redeploy — consolidation fix; transfer deferred).
6. **`recalcReturner` is NOT dead** — it IS the returner-hitter recompute (via `precompute-returner-hitters`). Only `calculatePrediction` (truly dead) was deleted.

---

## WHAT'S ON STAGING vs PENDING PROD
- **Staging (applied):** all of Steps 0-4 above + std_pr + the migrations (`pitch_log_pitcher_totals.ip`, Master UNIQUE constraints). Committed code: derive script, computeNcaaAverages (dual-write + exit-velo fix), createPredictions (from_*_plus fix), computeStdPr, pitchingEquations/predictionEngine/buildTransfer (SD defaults), recompute-cascade wiring, edge fn rebuild.
- **Pending prod:** ALL of it. Runbook `PROD_PUSH_RUNBOOK_war_recalibration.md` Parts A-G. Trevor drives the push. Deploy edge fn if the on-demand path is wanted on prod.

## NEXT STEPS (detailed, not just headlines)
1. **Isolate the pure SD impact** (optional): re-run the movers filtered to `combined_used=false` + PA≥75 to show the SD/power-rating effect without small-sample-blend churn.
2. **The 1 hitter update error** (of 8235) — identify the failing row (likely a bad/edge row; minor).
3. **Verify globally** before prod: server-side `count(*) FILTER (WHERE park_code IS NULL)` on pitch_log; confirm no NULL leaks in the Masters after derive.
4. **Deploy the edge fn to staging** if on-demand/admin recompute is needed (batch already ran via scripts). Trevor: "you deploy."
5. **PROD PUSH** — execute the runbook in order (Parts A/B schema → F derive → G0 Stuff+ → G1 ncaa+model_config → compute_scores → std_pr → G2 create_predictions → G3 recompute). Regenerate values on prod (don't copy staging). Reconcile the legacy `iso/obp_power_rating` Conference Stats columns (display check) before any drop. Trevor drives merge.
6. **Consolidation (north star):** fold Steps 0-4 into ONE edge fn (autonomous on upload). Port the pitcher recompute into the edge fn (currently a script). Wire the transfer edge fn's pitcher pr_sd to read model_config (kill the hardcoded copies). Batch the per-row stub updates in create_predictions (currently 1-at-a-time, ~6 min).

## DEFERRED / SEPARATE SESSIONS
- **TRANSFER equation** — the SD + weighted-impact (env+ ratio conversion + weights) is NOT settled; do NOT run transfer projections until finished + verified. The conference env+ pitcher lever is still `z×20` (hitters `(conf/ncaa)×100` ratio) — put pitcher on the ratio.
- **Conference-to-conference rollups** (env+/Stuff+/HTP) — batched with the transfer work.
- **JUCO** — entirely out of scope; separate audit + equation.
- **HTP park-factor** (`(100−wRC+)` → conference park factor) — modeled, decide + wire.
- **vaa / classification_version** — pitch-log upload miss, deferred.
