# STUFF+ — EXACT VALUES (single source of truth). 2026-08-28.
> ## ★ CURRENT STATE — READ FIRST (2026-08-30). This supersedes every older statement in this file.
> - **LANE (TOP DOG):** the only correct Stuff+ lane is the **pitch_log lane** —
>   `pitch_log.pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus` →
>   `aggregate_pitch_log_dimensions.ts` → `pitch_log_pitcher_totals` / `_by_pitch_type` → Season Stats + PitcherProfile.
>   **armHB throughout, self-consistent, CORRECT.**
> - **LEGACY LANE (≤2025 + JUCO ONLY, NEVER 2026):** `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
>   `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. It stores RAW hb, and since commit `e5dec2f` the
>   shared equations expect armHB — so running it scores **LEFT-HANDERS BACKWARDS**. Not live, not on main. Every step in
>   this document has been rewritten onto the pitch_log lane; if you find one that still routes through the legacy lane,
>   it is WRONG. (`legacy_breakingBallReclassification.ts`, renamed from `breakingBallReclassification.ts`, never touched
>   `pitch_log` and is NOT the anchor classifier.)
> - **CLASSIFIER:** `src/savant/lib/stuffPlusClassifierV2.ts` is the SINGLE source (`scripts/reclassify_v2.ts` is only a
>   validation harness; its duplicate copy was deleted). **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix /
>   needs_review 8.1%** on the full 2,000,674-pitch population. ⚠ SUPERSEDED — never quote as current: **92.6%, 94.3%,
>   95.1%, "~85%", and any "projected ~95.3-95.4%"**.
> - **DECISION (Trevor, FINAL):** standardize on v2 in **BOTH** environments — **DO overwrite staging's labels.** Any
>   "do NOT overwrite staging's labels" guidance anywhere is REVERSED and obsolete.
> - **STAGING:** the v2 chain is RUN + VERIFIED — backup `_v2_prechain_backup` (2,579,655 rows, DO NOT DROP) ·
>   2,015,321 classified/stamped `v2-ranges-2026-08-28` (needs_review 8.1%) · `_reclass_pf` materialized (5,364
>   pitchers) · baseline armHB SIGN CHECK PASSED 18/18 · 2,015,321 scored + recentered (every type×hand bucket exactly
>   100.0) · step 4 all 48 dimensions + `populate_hitter_run_values`. **Still open on staging:** step 5
>   `derive_masters_from_pitchlog.ts` is DRY-RUN ONLY (0 hitters / 4,675 pitchers would change; never applied on ANY env).
> - **PROD:** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

**Every number we decided, in one place.** Classifier thresholds, algorithm gates, the 9 scoring equations, the derived
ranges, validation results. Source code: **`src/savant/lib/stuffPlusClassifierV2.ts` (the SINGLE classifier)** +
`src/savant/lib/stuffPlusEngine.ts` (scoring); `scripts/reclassify_v2.ts` is a VALIDATION HARNESS only and no longer
carries its own copy. Writer: `scripts/reclassify_prod.ts`. `classification_version = "v2-ranges-2026-08-28"`.
★ **The CURRENT accuracy is §11.13: 95.2% per-pitch / 95.3% arsenal-mix / needs_review 8.1%.** Every earlier figure in
this file (§7's 92.6%, §11.7's 94.3%, §11.10's 95.1%) is a HISTORICAL waypoint — kept for the audit trail, NOT current.

---

## 1. CONVENTIONS
- `armHB = (hand == "R" ? hb : −hb)` — arm-side positive, glove-side negative. HANDEDNESS VERIFIED: armHB unifies both hands (raw hb flips sign, armHB doesn't). Classify on armHB, NEVER raw hb.
- `gap = primaryFB_velo − pitch_velo`. `primaryFB_velo` = mean velo of the pitcher's raw FA/SI (if ≥3 such pitches, else mean of all his pitches).
- `rr = ivb − |armHB|` (ride-vs-run). `ivb` = venue-corrected (`ivb_corrected`).

## 2. THE CLASSIFIER — per-pitch SEED (exact CASE, evaluation order is load-bearing)
```
1. ivb ≤ −8   AND armHB < 4  AND gap ≥ 4        → Curveball
2. armHB ≤ −12 AND ivb > −8  AND ivb ≤ 6        → Sweeper
3. ivb ≥ 5    AND gap ≥ 2 AND gap ≤ 7 AND armHB ≤ 2 → Cutter
4. gap < 4 (FASTBALL):  rr > 4 → 4S FB | rr < −4 → Sinker | else → FBSTRIP
5. |armHB| < 5 AND ivb ≥ −4 AND ivb ≤ 4         → Gyro Slider
6. armHB > 0:  spin < 1400 → Splitter | else → Change-up
7. else                                         → Slider
```

## 3. THE PER-PITCHER ALGORITHM (exact gates)
- **MERGE** seed-clusters if `|Δarmhb| < 4 AND |Δivb| < 3.5 AND |Δvelo| < 2.5`.
- **LABEL** each cluster by classifying its MEAN (armHB/ivb/gap/spin) via §2.
- **FBSTRIP RESOLUTION**: a FBSTRIP cluster → `4S FB if (cluster mean rr) ≥ 0 else Sinker`.
- **SMALL-SAMPLE FALLBACK**: pitcher `total < 150` pitches → label clusters by mean only (no fold/tiebreak).
- **ANCHOR** = cluster with `n ≥ 60 OR n ≥ 0.10 × total`.
- **SEAM-LOCAL USAGE BACKFILL (step 3)**: a cluster folds into a **strictly-larger** anchor (`anchor.n > cluster.n`) ONLY IF
  `moveDist < 5 AND |Δvelo| < 3`, where `moveDist = √(ΔIVB² + ΔHB²)`. Among candidates → pick the largest (usage). A cluster
  with NO larger anchor in-gate: if it's a non-anchor → keep its own label + `needs_review`; if it's an anchor → keep its label.
- **TIEBREAKERS** (after fold): 
  - Gyro/Curve blend: if `|armHB| < 5 AND −8 < ivb < −4` → `gap ≤ 8 → Gyro Slider | gap ≥ 10 → Curveball | else keep`.
  - CT/SL ride-floor: if label ∈ {Slider,Cutter} AND `gap ∈ [6,8] AND armHB ≤ 2 AND ivb ≥ 5` → Cutter. (arsenal-conversion DISABLED.)

## 4. DERIVED per-PITCH × HAND cluster-centroid RANGES `[p5·p25·p50·p75·p95]` (armHB-normalized; the boundaries live here)
```
4S FB:    rr[0·2·6·9·13]      armHB[3·7·10·12·15]   ivb[9·13·16·18·20]   gap≈0        velo[85·90·94]
Sinker:   rr[−14·−8·−6·−3·0]  armHB[6·14·16·18·20]  ivb[2·7·10·12·14]    gap≈0
Cutter:   rr[−3·4·6·8·14]     armHB[−8·−3·−2·0·3]   ivb[3·7·8·10·16]     gap[2·4·5·6·8]
Gyro:     rr[−10·−4·−1·1·5]   armHB[−6·−4·−3·−1·4]  ivb[−4·−1·1·3·7]     gap[5·7·9·10·12]
Slider:   rr[−13·−8·−5·−1·5]  armHB[−11·−8·−6·−4·4] ivb[−5·−1·2·4·8]     gap[5·8·9·11·12]
Sweeper:  rr[−21·−16·−10]     armHB[−18·−16·−14·−13·−12] ivb[−5·−3·−1·1·4] gap[8·10·11·12·15]
Curve:    rr[−29·−21·−12]     armHB[−17·−12·−10·−6·−2] ivb[−15·−12·−11·−9·−8] gap[9·13·17]
Splitter: armHB[6·8·10·13·18] ivb[−3·3·5·8·12]      gap[4·6·8·9·11]      SPIN[906·1071·1247·1366·1599]
Change:   armHB[6·11·13·15·18] ivb[−1·4·7·9·13]     gap[5·6·8·9·12]      spin[1508·1841·2267]
```
Golden rules (Trevor): gyro = 0-HB + NEG/neutral ivb (+ivb 0-HB = CUTTER). Set boundaries at the CORE (p25–p75), NOT the p95 tail — chasing tails regresses. Bleed at seams is fine.

## 5. SEED → LABEL OVERRIDES (from `_reclass_map`, 37,256 rows; 23.4% overridden)
`FBSTRIP → 4S 71% / Sinker 28%` · `SL → Gyro 33%` · `GY → Slider 19%` · `SI → 4S 6%` · `SPL → Change 10%` · `SL → Cutter 4%` ·
`FC → Gyro 6% / Slider 4%` · `CH → Splitter 3%` · `4S → Sinker 3%` · `CB → Change 4%`. needs_review ≈ 6.86% baseline golden (alert if it drifts UP).

## 6. THE 9 STUFF+ SCORING EQUATIONS (exact weights). `score = 100 + weighted × 20`. z=(x−μ)/sd; zAbs=|x−μ|/sd; zMax=(max(x,μ)−μ)/sd.
```
4S FB:     0.30·z(velo) + 0.25·z(ivb) + 0.15·zAbs(armHB) + 0.10·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.05·z(spin)
Sinker:    0.30·z(velo) − 0.20·z(ivb) + 0.30·z(armHB)    + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)
Cutter:    0.30·zMax(velo) + 0.15·z(ivb) − 0.25·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)
Gyro:      0.30·zMax(velo) + 0.15·(−z(ivb)) + 0.25·((hb_sd−|armHB|)/hb_sd) + 0.10·z(fbGap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)
Slider:    0.15·zMax(velo) + 0.10·(−z(ivb)) − 0.35·z(armHB) + 0.10·z(fbGap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)
Sweeper:   0.10·zMax(velo) − 0.10·z(ivb) − 0.40·z(armHB) + 0.10·z(fbGap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)
Curveball: 0.10·zMax(velo) − 0.30·z(ivb) − 0.15·z(armHB) + 0.10·z(fbGap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.15·z(spin)
Change-up: 0.15·z(fbChVeloDiff) − 0.20·z(ivb) + 0.35·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·zAbs(spin)
Splitter:  0.10·zMax(velo) − 0.20·z(ivb) + 0.25·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.25·(−z(spin))
```
(`fbGap`/`fbChVeloDiff` scored vs pop `velo_diff`/`velo_diff_sd`.) THIS is the "all-pitches Stuff+" — `calcGyroSlider` is the ONLY gyro eq (stuffPlusEngine.ts:305). NO separate gyro_stuff_plus. Then RECENTER each (pitch_type × hand) bucket to mean 100.

## 7. VALIDATION — ⚠ HISTORICAL WAYPOINT (2026-08-28), SUPERSEDED BY §11.13. Honest diverse 120-pitcher sample.
- Per-pitch match: **92.6%**. Arsenal-mix overlap: **93.0%**. needs_review: **8.6%**.
- **STUFF+ CROSS-CHECK** (`--stuffcheck`, per-pitcher overall Stuff+, v2 vs staging labels, same equations): **|Δ| mean 0.85, p50 0.44, p90 1.95; within ±1 = 78%, ±2 = 91%, ±3 = 96%.** → classification difference is product-invisible.
- Session arc: 85.2% (box-rules) → 87.8% (FBSTRIP) → 91.5% (derived ranges) → 92.6% (seam-local backfill).

## 8. A2 PROD DRY-RUN — ⚠ HISTORICAL (2026-08-28 build; needs_review has since settled at 8.1%). `reclassify_prod.ts --dry-run`, read-only, prod trbvxuoliwrfowibatkm
2,013,005 labels; needs_review 8.6%. Distribution (prod vs staging): 4S 37.7/37 · SI 16.1/16.5 · SL 11.1/14 · CH 10.6/9 · GY 7.9/6.4 · CB 5.6/5.7 · SW 5.2/5.6 · FC 3.7/3.6 · SPL 2.1/2.3. (SL/GY/CH = the known seam bleed; fastballs/SW/CB/FC/SPL dead-on.)

## 8b. FULL-POPULATION PER-ROW STUFF+ CALC — ⚠ HISTORICAL read-only rehearsal (`reclassify_v2.ts --score`, staging, 2026-08-28). The real chain has since RUN on staging — see the state section at the end of this file.
The real linear chain at scale: classify v2 → aggregate per (pitcher × label × hand) → score each row by label → recenter each bucket → per-pitcher rollup.
- **27,869 scored rows / 4,804 pitchers / 2,000,674 pitches** (= staging `_reclass_result` count exactly; 0 pitchers skipped). needs_review **8.6% per-pitch**.
- Per-pitcher OVERALL Stuff+: **p10 90.7 · p25 94.8 · p50 99.0 · p75 103.0 · p90 107.0 · mean 98.6** (centered ~99, tight realistic spread).
- Raw per-(type×hand) bucket offset from 100 BEFORE recenter (recenter then shifts each to exactly 100): 4S-R 104.7 (n=564k) · SI-R 102.0 · 4S-L 104.7 · SL-R 105.2 · CH-R 98.6 · GY-R 100.3 · SI-L 101.7 · CB-R 101.8 · SW-R 102.7 · CH-L 99.8 · FC-R 104.3 · SL-L 104.9 · GY-L 101.2 · SPL-R 101.1 · CB-L 101.8 · SW-L 102.9 · FC-L 103.8 · SPL-L 99.5. (All within 98.6–105.2 → no runaway bucket.)
- NOTE parity: `--score` recenters pitch-weighted; the production `stuffPlusEngine.ts:450` recenters **per-pitcher unweighted** — match the engine exactly when `--score` becomes the real producer.

## 9. CONFIG (model_config, 2026) — resolved 2026-08-28
- **2026 model WEIGHTS: identical** prod vs staging (62 keys, 0 diffs). ✓
- **2026 derived baselines/SDs** (`*_ncaa_avg`/`*_std_pr` etc.): per-env DERIVED (regenerated on prod in C27); prod holds the fresh `step8_model_config_2026.sql` recalibration (e.g. `r_obp_std_pr = 31.89504`, `t_ba_std_pr = 29.99699`). NOT synced — regenerate.
- **2025 WEIGHTS**: prod stale (18 differ + 17 missing); committed code = staging (e.g. `p_era_barrel_pct_weight 0.05`, `p_whip_whiff_pct_weight 0.45`). HISTORICAL only — does not affect 2026 push.
- WAR/composite: total = (o+d+bsr), scale ÷13.1 (migration 20260810); prod still on superseded ÷10 until `refresh_composite_war()` fires (F1). wRC+ = ((0.011 + 0.691·OBP + 0.235·SLG)/0.3782)·100.

## 10. VERSION STRINGS + KEY PATHS
- `classification_version = "v2-ranges-2026-08-28"` (A2 stamps this). Staging's was `v1-anchor-2026-08-17`.
- Classifier: **`src/savant/lib/stuffPlusClassifierV2.ts`** (the SINGLE source). Harness: `scripts/reclassify_v2.ts` (modes: --validate/--derive/--mismatches/--pitcher/--stuffcheck) — imports the classifier, does NOT duplicate it. Writer: `scripts/reclassify_prod.ts` (`--dry-run` / `--go` / `--target=staging`).
- Scoring: `src/savant/lib/stuffPlusEngine.ts` (`calculateStuffPlus`). Answer key: staging `_reclass_result` (2.0M) / `_reclass_map` (37,256) / `_reclass_pf` (4,804).
- Plan: `docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` §GO-FORWARD PLAN. Design: `docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`.

---
## 11. CLASSIFIER FIXES + DERIVED BOUNDARIES (2026-08-29) — all measured, none guessed

### 11.1 FIX — offspeed armHB FLOOR = 5  (`classifySeed` rule 6)
`if (armhb > 0)` → **`if (armhb >= 5)`**. DERIVED from anchor ground truth (120,000 pitches):
armHB per label `[p1·p5·p25·p50·p75·p95]` — **Gyro** `[−10.8·−8.0·−4.4·−2.5·−0.3·3.2]` (p99 = **4.7**);
**Splitter** `[5.2·5.9·8.7·11.5·14.2·17.6]`; **Change-up** `[5.4·7.2·12.1·15.0·17.6·21.2]` (offspeed p1 = **5.3**).
Clean empty gap 4.7 → 5.3, so the boundary is 5. Rule 6 previously fired from armHB>0 and swept the 0–5 band.
RESULT: `Gyro Slider → Change-up` 85/**338** losses → **eliminated**; `Cutter → Change-up` 1/**29** → **eliminated**;
disputes 2,059 → 1,443; coherence verdict "STORED better" → "MIXED".

### 11.2 FIX — FASTBALL-FAMILY MERGE GUARD  (`classifyPitcher` step 2) ★ the big one
Never merge two clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`) DIFFER. At gap≈0 the gate
(Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) is trivially satisfied across the fastball family, so MERGE swallowed the FBSTRIP
cluster BEFORE step 3 could resolve it on its own mean rr, then re-labeled the blob outside the ±4 strip.
**>60% of all 4S↔Sinker errors were merged FBSTRIP clusters** (272 Sinker→4S + 113 4S→Sinker, both seed=FBSTRIP merged=true).
MEASURED ablation (200 pitchers / 87,070 pitches): overall **91.69% → 93.01%**; 4S↔Sinker errors **2,830 → 1,676 (−41%)**.
(Full merge removal = 93.67% but costs the gyro benefit: `Gyro→Slider` 1,127→1,912. The family guard captures the
ENTIRE fastball win at lower risk.) Coherence: disputes **1,443 → 818 (−43%)**, agreed 54,887 → 55,318.
VALIDATED per-pitch behaviour: 14 IVB/8 HB vs 8 IVB/14 HB @ same velo → kept SEPARATE (4S FB + Sinker);
14/8 vs 13/9 (same pitch + noise) → correctly merged to ONE.

### 11.3 NEGATIVE RESULT — do NOT "optimize" the FBSTRIP cut
`rr >= 0` stays. A derived "optimal single cut" of `rr > −1.7` made agreement WORSE (disputes 1,443 → 2,503) because it
was fit on the POST-MERGE population where FBSTRIP no longer existed as a cluster. With the merge guard in place,
`rr >= 0` is within noise of optimal (best achievable **91.9% @ rr = −0.13**).

### 11.4 SEAM BOUNDARIES — verified ALREADY OPTIMAL, do not touch
- **Sweeper vs Slider on armHB: −12 is optimal** (misclassifies 243/24,449 = **1.0%**).
- **Gyro vs Slider on armHB: −5 is optimal** (v2 already uses it).
- Separation quality by axis for 4S vs Sinker: **rr 91.2%** > ivb 86.9% > armHB 79.9% > relH 76.7% > spin 65.1% > velo 64.0% > gap 62.4%. `rr` wins outright — there is no hidden spin/velo/slot axis.

### 11.5 THE ANCHOR DID NOT TRUST TRACKMAN TAGS (confirms movement-derived approach)
Anchor `Sinker` pitches: raw `FA` **54.3%** / raw `SI` 39.6%. Raw `FA` → anchor called **25.5% of them Sinker**.
Raw-tag agreement on fastballs = **77.2%** vs `rr` alone at **91.2%** → the anchor OVERRODE the raw tag on ~23% of
fastballs. (TrackMan auto-tags by VELOCITY, so a road sinker gets velocity-tagged as a 4-seam — the largest mistag in
the sport, and precisely what movement-based classification exists to fix.)

### 11.6 KNOWN REMAINING GAPS (documented, data exists, NOT yet implemented)
1. **`Gyro Slider → Slider`** — now the largest bucket, bigger than the whole fastball seam. `_reclass_map` shows the
   anchor's `SL` seed resolves `Slider 62.3% / Gyro 32.7%`, strongly ARSENAL-CONDITIONED:
   `hasGY/noSW/hasFC` n=782 → Gyro 69%/Slider 21%; `hasGY/noSW/noFC` n=394 → Gyro 63%/Slider 36%;
   `noGY/hasSW/noFC` n=345 → Slider 92%; `noGY/hasSW/hasFC` n=278 → Slider 86%. A GY seed roughly INVERTS the prior.
2. **`Change-up → Sinker`** (~362–383, stable across ablations) — the `gap < 4` fastball gate fires BEFORE the arm-side
   offspeed arm, so hard arm-side changeups within 4 mph of the FB get claimed by the fastball family.
3. **`Sweeper → Slider`** (~361–382) — the docs specify the `armHB ≤ −12` bar is SLOT-CONDITIONED; v2 uses a flat −12.
4. `tiebreak()` takes `_brkAnchorCount` and never reads it — the documented CT/SL arsenal rule ("2nd distinct breaking
   ball in arsenal → CUTTER; only breaking ball → SLIDER") is unimplemented.

### 11.7 FULL-POPULATION VALIDATION — ⚠ SUPERSEDED by §11.10 then §11.13 (current = 95.2%/95.3%). Kept for the error-ranking table.
`reclassify_v2.ts --validate --sample 4804` — ALL 4,804 pitchers, ALL 2,000,674 pitches vs `_reclass_result`.
FIRST run measured against the REAL classifier (scripts/reclassify_v2.ts previously carried a DUPLICATE copy of the
classifier; it now imports src/savant/lib/stuffPlusClassifierV2.ts — that duplication is why earlier numbers drifted).

**1,885,862 / 2,000,674 = 94.3% per-pitch  |  ARSENAL-MIX overlap 94.3%  |  needs_review 8.1%**
⚠ **NOT CURRENT** — this was pre-§4.5-gyro-fix. It superseded the stale 92.6% (duplicate copy) and was itself
superseded by §11.10 (95.1%) and finally §11.13 (**95.2% / 95.3% — the current number**).

Remaining 114,812 errors, ranked:
| pair | pitches | % of all errors |
|---|---|---|
| Gyro <-> Slider (25,197 + 13,071) | 38,268 | 33% |
| 4S <-> Sinker (14,184 + 12,614) | 26,798 | 23% |
| Gyro <-> Cutter (6,641 + 2,776) | 9,417 | 8% |
| Sweeper -> Slider | 8,136 | 7% |
| Splitter <-> Change-up (4,976 + 2,210) | 7,186 | 6% |
| Slider -> Cutter | 5,587 | 5% |
| Cutter -> Slider | 3,371 | 3% |
| Slider -> Curveball | 2,578 | 2% |
→ The GYRO/SLIDER seam alone is a THIRD of all remaining error (2x the fastball seam). The anchor's own rule for it is
already in `_reclass_map` (see 11.6 item 1) — arsenal-conditioned, learnable from data we hold. Closing most of it
would put v2 near 96%.

### 11.8 GYRO/SLIDER SEAM — research + FIX (2026-08-29). Biggest single remaining error source.
**Why it mattered:** Gyro<->Slider = 38,268 pitches = **33% of ALL remaining error** (2x the fastball seam).

**FINDING A — the seam is NOT separable per-pitch.** Anchor-labeled distributions `[p5/p25/p50/p75/p95]`
(350 pitchers / 149,726 pitches):
- **Gyro Slider** (n=13,051): armHB `-8.0/-4.3/-2.2/-0.1/3.1` · ivb `-6.1/-1.7/1.5/3.8/7.7` · rr `-11.4/-5.4/-1.5/1.7/5.7` · velo `75.9/79.5/81.6/83.8/86.9` · gap `5.1/7.2/8.6/10.2/12.9` · spin `1769/2116/2267/2437/2664`
- **Slider** (n=16,596): armHB `-11.4/-9.1/-6.7/-4.2/0.1` · ivb `-6.8/-2.9/0.9/4.7/9.9` · rr `-15.4/-10.2/-6.0/-1.2/6.0` · spin `1931/2207/2379/2533/2776`
- **Cutter** (n=4,769): armHB `-8.0/-4.3/-2.1/-0.1/1.8` · ivb `3.5/6.1/7.8/10.0/14.5` · gap `2.5/3.9/5.0/6.1/7.4`
Best single-axis PER-PITCH cut, Gyro vs Slider: **armHB 74.9% @ -4.08** (base rate 56%); rr 64.2 · spin 59.9 · velo 58.3 · gap 58.0 · ivb 56.0. The clouds share the whole -8..0 armHB band → no clean per-pitch threshold exists.
(Gyro vs Cutter IS separable: ivb 86.4% @ 5.49, gap 84.9% @ 5.68 — v2 already encodes this. Slider vs Cutter: gap 87.6% @ 6.05.)

**FINDING B — ⚠ THE "ARSENAL RULE" IS A CONFOUND. DO NOT IMPLEMENT IT.**
`_reclass_map` really does show SL-seed resolution flipping with arsenal (GY+SL 64.5% Gyro; GY+SL+FC 67.7%; GY+SL+FC+CB 70.4%; vs SL+SW 95.0% Slider; GY+SL+SW 85.8% Slider). BUT regressing the anchor's SL resolution on
per-pitcher features (n=165 pitchers with both GY and SL clusters >=8 pitches):
| predictor | accuracy |
|---|---|
| majority class | 56.4% |
| hasSW alone (the "arsenal rule") | 71.5% |
| **SL cluster mean armHB alone** | **89.1% @ armHB >= -5.10** |
| slAr x hasSW (two thresholds) | 89.7% (noSW -5.1 / hasSW -5.3) |
The two conditional thresholds are nearly identical and arsenal adds only +0.6pp over movement alone → **sweeper
presence is a PROXY for "this pitcher's SL cluster sits further glove-side," not an independent rule.**
Implemented literally it **LOSES 0.97pp (sample A) / 1.26pp (sample B)** — fixes Gyro->Slider 1,675->613 but creates
Slider->Gyro 1,298->3,819. Recorded so nobody rebuilds it from the contingency table.

**FINDING C — THE FIX (shipped): cluster-centroid floor `GYRO_ARMHB_FLOOR = -3`.**
After step 4 (usage backfill) and **BEFORE step 5 (`tiebreak`)**: any cluster labeled `Slider` with mean armHB >= -3
becomes `Gyro Slider`. Same line in the `<150` small-sample branch.
Threshold sweep (Δpp vs base), two DISJOINT samples — A: 350 pitchers/149,726 pitches (base 92.488%); B: 300 pitchers/126,672 pitches (base 93.850%):
| variant | A Δpp | B Δpp |
|---|---|---|
| arsenal rule (flip all Sliders when noSW & hasGY) | **-0.974** | **-1.262** |
| widen §1.5 gyro IVB band to ±6 | -0.350 | — |
| widen §1.5 gyro IVB band to -6..+8 | -0.740 | — |
| post-tiebreak flip, armHB >= -5 | +0.106 | +0.030 |
| post-tiebreak flip, armHB >= -4.5 | +0.572 | +0.574 |
| post-tiebreak flip, armHB >= -3 | +0.771 | +0.948 |
| **pre-tiebreak flip, armHB >= -3  ← SHIPPED** | **+0.960** | **+1.242** |
| pre-tiebreak, armHB >= -2.5 | +0.765 | +1.159 |
| pre-tiebreak, armHB >= -3.5 | +0.724 | +0.988 |
| pre-tiebreak, armHB >= -4.5 | +0.749 | +0.858 |
| pre-tiebreak -3 + require noSW | +0.888 | +1.203 |
| pre-tiebreak -3 + ivb >= -6 gate | +0.900 | +1.242 |
Pitch-weighted across both samples (276,398 pitches): **+1.09pp**. Stability: split-half Δ = +0.884/+1.038 (A) and
+1.376/+1.119 (B); -3 is argmax in 3 of 4 half-splits; every threshold -1..-4.5 is positive on BOTH samples.
Confusion deltas (A base->new | B base->new): `Gyro->Slider` 1,675->471 | 1,788->508 · `Gyro->Cutter` 415->131 | 437->56 ·
`Slider->Gyro` 1,298->1,348 | 1,046->1,125 · **all fastball + offspeed pairs IDENTICAL** (4S->SI 1,638->1,638; SI->4S 1,592->1,592).

**ORDERING IS LOAD-BEARING:** running before `tiebreak()` is worth ~+0.3pp over after, because the CT/SL ride-floor
tiebreak (`Slider & gap 6-8 & ar<=2 & iv>=5 -> Cutter`) then never fires on these clusters — that IS the Gyro->Cutter drop.

**⚠ DOWNSTREAM IMPACT — NOT display-only.** This moves **6-8% of ALL breaking-ball volume** from Slider to Gyro Slider.
Every artifact computed on the old mix MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines,
D1/regional means + SDs, pitch-shape percentiles. Reinforces the invariant: reclassify -> baseline -> score -> aggregate
must complete in ONE session.
**Honest caveat:** Curveball errors are RELABELED not fixed (`Curveball->Slider` 108->2 offset by `Curveball->Gyro` 131->237, net ~0).

### 11.9 ★ METHODOLOGICAL WARNING — "agreement with the anchor" IS NOT ACCURACY
The anchor is the PREVIOUS classifier's output (a lost scratchpad implementation), NOT ground truth. A 94.3% agreement
figure measures SIMILARITY TO THE ANCHOR. The residual ~4.7% is a MIX of (a) v2 wrong, (b) **v2 RIGHT and the anchor
wrong**, (c) genuine coin-flips. Evidence that (b) is real: two 2026-08-29 fixes (the offspeed armHB floor and the
fastball merge guard) were "be physically correct" changes — a +1 armHB pitch is not a change-up; a 14ivb/8hb and an
8ivb/14hb at equal velo are two different fastballs — that happened to ALSO raise agreement.
→ Use the CLUSTER-COHERENCE test (`scripts/v2_coherence_test.ts`) to partition the residual: it scores which label puts
a disputed pitch closer to its own movement centroid, using centroids built ONLY from pitches both labelings agree on
(unbiased). Coherence readings so far: BEFORE fixes stored won 55.1/44.9 on 1,443 disputes; AFTER the merge guard
40.1/59.9 on a much smaller/harder residual (818 disputes) — fewer, harder disputes is what a real fix looks like.
⚠ Coherence favours tighter clusters and is a PROXY, not truth: treat >=60/40 as meaningful, ~50/50 as genuinely ambiguous.
→ The overwrite question this paragraph left open is now CLOSED — see §11.12: we standardize on v2 in BOTH environments
and DO overwrite staging, on reproducibility grounds rather than on a sample-accuracy edge.

### 11.10 FULL-POPULATION ACCURACY AFTER THE GYRO FIX — ⚠ SUPERSEDED by §11.13 (the §4.5 reorder took it to 95.2%/95.3%)
`--validate --sample 4804`, ALL 2,000,674 pitches vs `_reclass_result`:
**1,903,348 / 2,000,674 = 95.1% per-pitch  |  arsenal-mix 95.2%  |  needs_review 8.1%**
(was 94.3% / 94.3% / 8.1% before §4.5 → **+0.8pp**, total errors **114,812 → 97,326**, −17,486.
Slightly under the +1.09pp sample projection — samples were mildly optimistic. This 95.1% killed the "projected
~95.3-95.4%" wording for good — but 95.1% is itself **NOT current**: §11.13 moved §4.5 BEFORE the step-4 backfill and
landed at **95.2% / 95.3%**.)
Confusions after (vs before): `Gyro→Slider` **25,197 → 7,210 (−71%)** · `Gyro→Cutter` 6,641 → 4,350 ·
`Slider→Gyro` 13,071 → 15,838 · `Sweeper→Slider` 8,136 → 8,114 · **`4S→Sinker` 12,614 → 12,614 and
`Sinker→4S` 14,184 → 14,184 — BYTE-IDENTICAL, zero fastball regression, exactly as predicted.**
Gyro/Slider pair total 38,268 → 23,048 (−40%) but still the largest bucket; v2 now slightly OVER-calls gyro
(`Slider→Gyro` is now the single biggest confusion) — the residual seam is symmetric-ish, not one-directional.

### 11.11 COHERENCE PARTITION OF THE RESIDUAL — ⚠ ITS MEASUREMENT STANDS, ITS CONCLUSION IS REVERSED BY §11.12
⛔ **Read §11.12 first.** The 55.9/44.1 anchor edge below is real and is retained as evidence, but the "do NOT overwrite
staging" conclusion drawn from it was too narrow and is **OBSOLETE** — we standardize on v2 in BOTH environments.
`scripts/v2_coherence_test.ts --sample 250`, run AFTER all three fixes (v2 at 95.1%). Unbiased design: centroids built
ONLY from pitches both labelings agree on, then each disputed pitch scored by distance to its v2-label vs anchor-label centroid.
**234 pitchers | 102,872 agreed | 1,308 disputed → v2 closer 524/1,188 = 44.1% · ANCHOR closer 664/1,188 = 55.9%**
→ **The residual ~4.9% is NOT mostly "v2 right / anchor wrong."** The anchor wins it ~56/44. The hypothesis that
agreement-below-100% might largely be v2 IMPROVING on the anchor is REJECTED by measurement.
→ ~~**DECISION: do NOT overwrite staging's `pitch_type_reclassified` with v2.**~~ **REVERSED — see §11.12.** The final
  decision is to **DO overwrite staging**, standardizing on v2 in both environments.
→ **Does NOT affect the PROD decision:** prod is on OLD per-pitch CASE labels, not anchor labels. v2 beats those
  decisively (70.9% agreement; distribution deviation from the validated set 38.7 → 21.6; Cutter 10.3%→3.7% vs anchor 2.4%).
Per-move (v2 wins / anchor wins): `Slider→Cutter` **23/0 (v2 100%)** · `Sinker→4S FB` 246/211 (v2 54%) ·
`Change-up→Sinker` 43/55 · `4S FB→Sinker` 39/53 · `Change-up→Splitter` 8/15 · `Cutter→4S FB` 3/18 (anchor 86%) ·
`Sweeper→Slider` **85/216 (anchor 72%)** · `Gyro Slider→Sinker` **0/20 (anchor 100%)**.
⚠ **LIMITATION — the partition does NOT cover the largest residual.** Gyro↔Slider (23,048 pitches, the biggest bucket)
is ABSENT from the breakdown: the test needs >=5 agreed pitches per label to form a centroid, and after the §4.5 fix many
gyro/slider disputes no longer have both. So this measures the OTHER residual. Whether the -3 floor over-calls gyro
relative to physical truth is STILL UNMEASURED — do not claim it either way.
→ **BEST-EVIDENCED NEXT FIX: `Sweeper→Slider`** (8,114 pitches; coherence says v2 is wrong on 72%). The docs specify the
sweeper `armHB <= -12` bar is SLOT-CONDITIONED; v2 applies it flat. See 11.6 item 3.

### 11.12 ★★★ THE DECISION (FINAL, Trevor): STANDARDIZE ON v2 EVERYWHERE — overwrite staging too. Supersedes §11.11.
11.11 measured that the ANCHOR wins the residual 56/44. That measurement stands. The DECISION nonetheless is to
**overwrite staging's `pitch_type_reclassified` with v2**, because accuracy-on-a-sample is not the deciding criterion —
**reproducibility and cross-environment consistency are.**

**COST, quantified:** the anchor's edge is 56/44 on DISPUTES ONLY. Disputes ≈ 4.9% of pitches (97,326), so the net
advantage ≈ 12% × 97,326 ≈ **11,700 pitches ≈ 0.6% of the population**. That is the entire price.

**WHAT THAT 0.6% BUYS:**
- The anchor has **NO SOURCE CODE** (lost scratchpad) → it can never be re-run, on new data or on prod.
- Staging and prod would stay permanently on DIFFERENT, unstampable label sets → no valid cross-env accuracy check.
- Track B needs a classifier that runs on EVERY ingest. The anchor cannot. v2 can.
- One vocabulary (`4S FB`, not `4-Seam Fastball`) + a `classification_version` stamp on every row, in both environments.
Trevor 2026-08-29: *"we need to overwrite staging because it is the best known process that we have and it needs to be
consistent. Whatever wrote staging last time is just the one that got away."*

**SUPERSEDES:** the "do NOT overwrite staging" guidance in 11.11 and in SOURCE_OF_TRUTH §4. Those were argued purely on
the 56/44 accuracy edge and did not weigh reproducibility. The measurement was right; the conclusion drawn from it was
too narrow.

**OPERATIONAL CONSEQUENCE — staging gets the SAME full chain as prod, not just a label rewrite:**
1. run v2 → `pitch_type_reclassified` + `classification_version='v2-...'` + `needs_review` (also fixes the ~191k
   old-vocabulary `4-Seam Fastball` leftovers from pitchers the anchor run skipped → ONE vocabulary at last)
2. RE-DERIVE `pitcher_stuff_plus_ncaa` (MANDATORY — the §4.5 gyro fix shifts 6-8% of breaking-ball volume)
3. `compute_pitch_log_stuff_plus.ts` → 4. `aggregate_pitch_log_dimensions.ts` → 5. `derive_masters_from_pitchlog.ts`
All five in ONE session, on BOTH environments.
**PRESERVE `_reclass_result` (2,000,674 rows)** — it is the only surviving record of the anchor's output and remains the
historical reference/regression baseline. Do NOT drop it in the Phase-H cleanup.

(Phase-H drop rules — what must never be dropped — are consolidated in "PHASE-H CLEANUP" at the end of this file.)

### 11.13 ★★★ FINAL ORDERING + FINAL ACCURACY — §4.5 runs BEFORE the step-4 backfill. **THIS IS THE CURRENT NUMBER.**
Trevor's insight: a correctly-placed §4.5 should create NO work for the backfill. It was running AFTER the fold, so it
re-read each fringe cluster's own mean armHB and flipped back clusters the fold had just consolidated — manufacturing
phantom pitches. (The fold REASSIGNS a fringe cluster's LABEL to the dominant anchor's; it does not merge membership,
so a later rule re-reading that cluster's own centroid undoes it.)
**Moving §4.5 before step 4 is strictly better on BOTH metrics — not a tradeoff:**
| metric | §4.5 AFTER fold (was committed) | **§4.5 BEFORE fold (FINAL)** |
|---|---|---|
| per-pitch accuracy (full 2,000,674) | 95.1% (1,903,348) | **95.2% (1,904,808)** |
| arsenal-mix overlap | 95.2% | **95.3%** |
| pitchers with BOTH Gyro+Slider | 20% | **16%** |
| FRAGMENTED (fringe <12% vs >15%) | 7% | **5%** |
| median minority share of the pair | 2.8% | **1.1%** |
| `Slider → Gyro Slider` (over-calling) | 15,838 | **13,501** |
| `Gyro Slider → Slider` | 7,210 | 7,978 |
needs_review 8.1% in both. **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix.** Supersedes the 95.1% in §11.10.
The surviving 5% fringe are clusters the fold DECLINED to absorb (outside `moveDist<5` & `|Δvelo|<3`) — i.e. genuinely
distinct rare pitches, which is the intended behaviour: a real 2% pitch must survive. ⚠ UNMEASURED: whether those
5% are truly distinct or ghosts leaking a slightly-too-tight gate (measurable via their actual moveDist distribution).
⚠ PROCESS NOTE: this reorder was swept into a Stage-0 plumbing commit by `git add -A` instead of being committed on its
own measurement. Modeling changes must land in their own commit with their number attached.

---
## 12. STAGING FULL-CHAIN EXECUTION LOG (2026-08-29) — the first real write of the v2 chain
Env: STAGING `slrxowawbijbjrkozqlj`, direct session (Supavisor session mode :5432) via `PGURI` in `.env.local`.
Chain: classify → re-derive baseline → score per pitch → aggregate dimensions → marry onto Masters. ONE session.

### STEP 0 — BACKUP (done, reversible)
`_v2_prechain_backup` created on staging (unique index on `uniq_pitch_id`):
**2,579,655 rows | 2,191,583 labeled | 2,014,152 with stuff_plus** — snapshot of `pitch_type_reclassified`,
`classification_version`, `needs_review`, `stuff_plus` immediately BEFORE the chain. Any step is reversible with a
single UPDATE…FROM join on `uniq_pitch_id`. ⚠ Do NOT drop this until the chain is verified end-to-end.

### STEP 1 — RECLASSIFY (v2) — `reclassify_prod.ts --go --target=staging`
- Classifier: `src/savant/lib/stuffPlusClassifierV2.ts` @ **95.2% per-pitch / 95.3% arsenal-mix** (§11.13).
- **2,015,321 labels computed** (vs 2,000,674 in `_reclass_result` — v2 covers slightly more because it labels every
  `is_data=true` row with movement, whereas the anchor run skipped ~191k rows belonging to pitchers it never processed).
- Stamps `pitch_type_reclassified` + `classification_version='v2-ranges-2026-08-28'` + `needs_review`.
- Also MATERIALIZES `_reclass_pf` (pitcher_id → pf_velo) as a by-product — first ever run of that new code path; the
  scorer hard-depends on it (`compute_pitch_log_stuff_plus.ts:132-135` exits without it).
- ⚠ OBSERVED IO THROTTLING mid-run: `_reclass_fix` load ran ~21s per 200k for the first ~1.2M rows, then degraded to
  **~4.3 min per 200k**. This is the documented burst→baseline pattern (burst budget ≈5 min, then baseline). Expect
  the same, worse, on prod — prod is on a smaller compute tier and its disk is more throttled.
- Resumability confirmed by design: `_reclass_fix` is upserted by PK and the pitch_log UPDATE carries
  `is distinct from` guards, so an interrupted run can simply be re-run.

### WHAT THIS RUN PROVES (first-ever execution of the corrected chain)
1. `_reclass_pf` materialization works (new code).
2. The version stamp written in step 1 MATCHES the filter step 3 reads — the STAGE-0 blocker #2 fix
   (`compute_pitch_log_stuff_plus.ts` was hard-filtered to `v1-anchor-2026-08-17`) actually holds end-to-end.
3. The `--target=staging` double-keyed guard on the writer works (it refuses unless PGURI's project ref matches).

### STEP 1 RESULT (staging, 2026-08-29) ✅
`classified 2,015,321 pitches | needs_review 8.1%` · `_reclass_pf materialized: 5,364 pitchers` (NEW producer, first
ever run — worked) · `batches=101, updated=1,995,321, version_stamped=2,015,321/2,579,655`.
Distribution: 4S FB 37.8% · Sinker 16.0% · Slider 10.3% · **Gyro Slider 10.2%** · Change-up 9.1% · Curveball 5.6% ·
Sweeper 5.2% · Cutter 3.7% · Splitter 2.1%. (Gyro up from ~6.4% — the §4.5 floor, as expected.)
The ~20k gap between stamped (2,015,321) and updated (1,995,321) is the `is distinct from` guard skipping rows whose
label was already identical. The remaining ~564k unstamped rows are `is_data=false` — correctly left UNLABELED
(the old process had wrongly labeled ~8% of non-data rows).

### STEP 2 RESULT (staging) ✅ — armHB CONVENTION EMPIRICALLY CONFIRMED
`✓ sign check passed on all 18 buckets` → `APPLIED — upserted 18/18 pop buckets for season 2026`.
**This is the proof, not an assumption:** every arm-side bucket (4S FB/Sinker/Change-up/Splitter) came out POSITIVE
for BOTH hands and every glove-side bucket (Slider/Sweeper/Curveball) NEGATIVE for both. The deriver was built to
ABORT before writing if that failed. The whole 2026-08-29 lane analysis holds. (e.g. Sweeper::R hb = −15.9, sd 2.94.)
Also proves the producer→consumer link: step 1 WROTE `_reclass_pf`, step 2 READ it back (5,364 pitchers).

### ⚠ STEP 3 FAILURE #1 (staging) — transient network, chain halted CORRECTLY
`scored=1,665,000` (~83%) then `TypeError: fetch failed / read ECONNRESET`. Step 4 did NOT run (halt-on-failure worked).
**RESULTING PARTIAL STATE — the exact invariant violation we guard against:** staging held **v2 labels + STALE
anchor-era scores** (`v2-stamped 2,015,321 | scored 2,014,152 | unscored 1,169`; the 2,014,152 matches the pre-chain
backup exactly, i.e. those were the OLD scores sitting under NEW labels). The recenter pass never ran.
→ **LESSON: step 3 is the single longest unattended step (~19+ min, ~1,700-2,700 rows/s, degrades under IO
throttling) and had NO retry.** Re-run wrapped in 4 attempts. It is idempotent — `compute_pitch_log_stuff_plus.ts:185`
re-scores ALL rows matching the class version (it does NOT filter `stuff_plus IS NULL`), so a re-run redoes the full
~2M rather than resuming. Budget the full runtime on every attempt.
→ **PROD IMPLICATION: prod is on a smaller compute tier with a more throttled disk. Do NOT run step 3 on prod
unattended without retry, and expect materially longer than staging's ~19 min.**

---

## ★★★ THE STUFF+ CHAIN — pitch_log lane (the ONLY correct order)
Any Stuff+ step that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. It
revives the latent raw-HB bug (`e5dec2f` removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Never run it for 2026.**

1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?";
   `--target=staging` for staging). Also MATERIALIZES `_reclass_pf` as a by-product — the scorer hard-depends on it.
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves 6-8% of ALL breaking-ball volume Slider→Gyro Slider, so every
   mix-dependent artifact is invalid until regenerated. The deriver ABORTS before writing if the armHB sign check fails.
3. **Score per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   🛑 **MUST READ BEFORE RUNNING THIS STEP:** the version filter is now parameterized (`--class-version=`, defaulting to
   the v2 stamp) — it used to be hard-coded to `v1-anchor-2026-08-17`, which silently matched 0 rows and left NEW LABELS
   + OLD SCORES. This step is idempotent but does **NOT** resume: every attempt costs the FULL runtime (~36 min on
   staging, longer on prod) and a mid-run failure leaves v2 labels + STALE scores. Run it DETACHED with
   `caffeinate -dimsu -w <pid>`. Requires `_reclass_pf` (materialized by step 1).
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
   🛑 **MUST READ BEFORE RUNNING THIS STEP → see "STEP 4 — SOLVED: USE `--direct`" below.** On PROD you MUST run ALL of
   step 4 with `--direct` (the HTTP gateway cuts at ~125s; `vs_top_hitters` needs 253s on staging, longer on prod, and a
   failure HALTS the dimensions after it). Validate by CONTENT + FRESHNESS — never by exit code or row count.
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (its `readAll` pagination is now `.order(PK)`-ed — unordered `.range()` over ~2.5M rows silently dropped/duped).
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave an environment with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`; exact numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.

---

# STAGE 0 — PRE-PROD BLOCKER STATUS (updated 2026-08-30): **1 OPEN, THE REST RESOLVED**
Prod's **DATA is ready** — 100.00% of prod's `is_data=true` rows (~1,906,398) are v2-classifiable, venue corrections
resolve, same games/window as staging. Every blocker was CODE or SCHEMA, and all but one have shipped.

## ⛔ STILL OPEN — the only thing blocking the prod chain
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's query against prod returns
   `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from the
   data-write "prod, now?".** (Reclassification itself is unaffected — `reclassify_prod.ts` doesn't read those columns.)

## ✅ RESOLVED — shipped; do NOT re-raise these as blockers
2. **Scorer version filter — RESOLVED.** It was hard-coded `.eq("classification_version","v1-anchor-2026-08-17")` while
   `reclassify_prod.ts` stamps `v2-ranges-2026-08-28`, so it silently matched 0 rows (new labels + old scores). It is now
   **parameterized (`--class-version=`, defaulting to the v2 stamp)**. *Evidence:* on staging steps 1→3 connected
   end-to-end and scored 2,015,321 rows. (This also supersedes the old checklist item "do NOT loosen the filter".)
3. **`_reclass_pf` producer — RESOLVED.** `reclassify_prod.ts` now materializes it as a by-product of `pfbVelo()`.
   *Evidence:* the staging run materialized **5,364 pitchers**, and step 2 read it back.
4. **`aggregate_pitch_log_dimensions.ts` prod path — RESOLVED.** It now has a prod path + a `--prod` guard, plus the NEW
   `--direct` and `--only=` flags. *Evidence:* `--direct` cleared `vs_top_hitters` on staging in 253.2s.
5. **§4.5 ordering — RESOLVED.** §4.5 runs BEFORE the step-4 backfill; measured **95.2% / 95.3%** (§11.13) — strictly
   better on both metrics than the 95.1% "after the fold" ordering, so there is nothing left to measure or revert.
6. **Ordered pagination — RESOLVED.** `derive_masters_from_pitchlog.ts` `readAll` is ordered, plus two further
   ordered-pagination fixes (`backfill_trackman_pitches_pitching_master.ts`, `compute_conf_pitcher_env_plus.ts`).
7. **Legacy lane gated out of the live prod CSV path — RESOLVED.** `scripts/import-csvs/runner.ts` (= `npm run
   import:prod`, which goes DIRECT to prod) no longer runs the legacy raw-HB lane, and npm `recompute-stuff:prod` /
   `recompute-stuff-scoped:prod` were **DELETED**. A routine TruMedia import can no longer score left-handers backwards.
8. **Ledger entries — RESOLVED.** C20 park_code (2,576,146 = 100%), C21 `is_conference_game` + C22 sequence
   (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql` are all logged in
   `PROD_MIGRATIONS_TODO.md`.
9. **Staging reclassification writer — RESOLVED.** `reclassify_prod.ts --target=staging`, with a double-keyed guard
   (it refuses unless PGURI's project ref matches the named target).

## ⚠ CLAIMS THAT ARE FALSE — audits disproved them; do not treat any of these as live blockers
"A5 aggregator (pitch_log → `pitcher_stuff_plus_inputs`) is missing" · "the baseline deriver is missing" ·
"the live path has a pop/row convention mismatch" · "the v2 reclassification WRITER does not exist" ·
"the classifier is only ~85% and cannot reach its gate". All verified present / correct / superseded.

## OPEN BUT NOT BLOCKING
- **C21/C22 derive-over-copy follow-up.** They were COPIED from staging (`_next_derived.ts`), not derived. Prod must be
  able to DERIVE `park_code` / `is_conference_game` / sequence going forward or **Track B breaks on the next ingest.**
- **Migration `20260829120000_gm_budget_nil_allocation_mode.sql`** — committed, **NOT yet applied to either env.**
- **Row-count populations, pinned so gates are falsifiable** (these are DIFFERENT populations, not a contradiction):
  2,576,230 = prod pitch_log total pre-dedup · 2,576,146 = park_code/is_conf/sequence filled · ~2,176,888 = prod rows
  carrying an OLD CASE label · 2,013,005 = the v2 prod DRY-RUN label count · **prod `is_data=true` ≈ 1,906,398**
  (74.01% of 2,575,996) · staging v2 classified/stamped = 2,015,321.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).

---

# ▶️ STAGING + PROD STATE, AND THE NEXT ACTIONS (2026-08-30)

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = **2,579,655 rows** / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review **8.1%**, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored = 0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **ALL 48 dimensions refreshed** + `populate_hitter_run_values(2026)` ✓. The 3 `vs_top_hitters` aggregations that had failed on the gateway were completed over the DIRECT pg session (`--direct`). Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 ·
4,234 pitchers.** Prod must land within tolerance of this or **ABORT**.

## ⚠ STILL OPEN ON STAGING
- **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY.** Dry run: **0 hitters / 4,675 pitchers** would change
  (of 4,772 above-gate). It has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Review + apply step 5 (Masters) on staging.
2. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
3. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
4. Prod chain: reclassify → baseline → score → aggregate (**`--direct` from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the pitch_log lane.

## ⏱ PROD TIME BUDGET
Staging actuals: step 1 ≈ **75 min** (load + classify + 2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**
→ **staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already
times out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in **ONE sitting** with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split,
because a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (it re-scores everything matching the class version), so any interruption costs the FULL
runtime again. The two-phase fix (score only `stuff_plus IS NULL`, then ALWAYS recenter across the full population) is
worth building BEFORE the prod run — the recenter must see the whole population, which is why a naive resume is wrong.

---

# ✅ STEP 4 (`aggregate_pitch_log_dimensions`) — SOLVED: USE `--direct`. (staging-proven 2026-08-30)
**ROOT CAUSE CONFIRMED, not theorised.** Every aggregation in this script ran through `exec_sql` over the HTTP gateway
(`aggregate_pitch_log_dimensions.ts:1035`), and the gateway cuts the client at ~125s — the work is LOST.
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`, **reproduced EXACTLY twice**
(same dimension, same error, same duration). That query must resolve the top-quartile hitter set (~967 IDs) and filter
~2M pitches against it. Over the **DIRECT pg session the SAME query succeeded in 253.2s** — it simply needs ~2× the
gateway's ceiling; nothing else changed. 47 of 48 dimensions run fine (~60-72s each). ⚠ The script **HALTS** on a
failure, so dimensions 41-48 never ran either — one bad dimension blocked 9.

## THE COMMANDS
Staging (single dimension):
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
**PROD — run the WHOLE of step 4 with `--direct`, not just this dimension:**
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
`vs_top_hitters` already needs 253s on STAGING. Prod is a smaller compute tier with a more throttled disk (expect
~8-10 min for that one dimension) and prod's `exec_sql` has ALREADY been observed timing out on lighter queries →
through the gateway it would fail on prod **100% of the time**, and the halt would block the 8 dimensions after it.
**`--direct` is NOT a staging workaround — it is the REQUIRED path on prod.**

## FLAGS ON `aggregate_pitch_log_dimensions.ts`
- **`--direct`** (new 2026-08-30) — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling)
  instead of `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs the path used.
- **`--only=<keys>`** (new 2026-08-30) — mirrors `--skip=`; runs ONLY the named dimension(s), so one failed dimension can
  be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- **`--skip=<keys>`** (existing) — skip named dimensions.
- **`--prod`** guard + prod path (added at Stage 0).

## ⚠ THE TWO TRAPS — validate by CONTENT and FRESHNESS, never by exit code or row count
- **A failed dimension leaves STALE rows that LOOK populated.** When `vs_top_hitters` failed, `pitch_log_pitcher_totals`
  still SHOWED **5,349 rows** for that `dimension_key` — left over from a PRE-v2 run, computed from OLD labels and OLD
  Stuff+ scores. **A row-count check would have passed.** → After ANY reclassification, verify a dimension by
  FRESHNESS (did *this* run write it?), never by row count.
- **The script EXITS 0 even when a dimension FAILED.** → grep the log for `FAILED` and for the per-dimension `ok`.
  A run was wrongly marked COMPLETE this way on 2026-08-29.

## RESUMABILITY OF THE CHAIN (know what a restart costs)
| step | resumable? | why |
|---|---|---|
| 1 `reclassify_prod.ts` | ✅ FULLY | keyset on PK + `is distinct from` guards + `_reclass_fix` upserted by PK. A re-run skips completed rows. |
| 3 `compute_pitch_log_stuff_plus.ts` | ❌ NO — and it is the costliest to lose | re-scores ALL rows matching the class version instead of filtering `stuff_plus IS NULL`. Every attempt costs the FULL runtime (~36 min staging, longer on prod), and a mid-run failure leaves **v2 labels + STALE scores**. FIX (future): two phases — score only NULLs, then ALWAYS recenter the full population (the recenter must see everything to shift each bucket to mean 100). |
| 4 `aggregate_pitch_log_dimensions.ts` | ⚠ MANUALLY | the 48 dims are independent and `--skip=`/`--only=` exist, but you must pass the completed keys BY HAND. FIX (future): auto-skip dims already written for this run-generation. |

## ⚠ ENVIRONMENTAL FAILURES — do not confuse them with the gateway timeout
Three failures the same night were the LOCAL MACHINE sleeping / dropping its connection, NOT script defects:
staging insert `TypeError: fetch failed` · STEP 3 scoring died at 1,665,000/2,015,321 (~83%) with `read ECONNRESET` ·
STEP 4 first run died at 13/48, second at 39/48.
**Distinguishing symptom:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters` failure died
at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED and let them take however long they need,** with
`caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not add
aggressive retry loops.

---

## 🏆 PHASE-H CLEANUP — WHAT MUST NEVER BE DROPPED
Phase H lists the Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these — plus `team_war_snapshots`:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Now that we standardize on v2, this is the SOLE way to ever measure
  against the old process — the regression baseline for every future classifier change.
- **`_reclass_map` (37,101 rows)** — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- **`_reclass_pf` (4,804 rows)** — per-pitcher primary-FB velo (the v2 staging run materialized 5,364 rows of it).
- **`team_war_snapshots`** — holds prod's irreplaceable 2025 champions (309 rows). NEVER drop.
Safe to drop: **`_reclass_fix`** (transient writer staging table only).

---
# ⚠️ `--direct` SILENT HANG — statement_timeout=0 removes the CEILING but also the FAILURE SIGNAL (prod, 2026-08-30)
**What happened:** the prod stage-4 run stalled on `[41/48] vs_top_hitters → pitcher_by_pitch_type` and sat there for
**39 minutes with zero log output**. Diagnosis over a second connection: **NO active query on prod** (`pg_stat_activity`
showed only my own catalog lookup) and **0 ungranted locks** — so the database was doing nothing. The client process was
alive but waiting forever. The direct connection had dropped and the client never learned about it.

**ROOT CAUSE — a gap in the `--direct` fix shipped earlier the same day.** To defeat the HTTP gateway's ~125s cut we set
`statement_timeout = 0` and a very long `query_timeout`. That correctly removes the ceiling that made `vs_top_hitters`
impossible over `exec_sql` — but it ALSO removes the only signal that something died. A dropped pooler connection
therefore presents as an INFINITE HANG instead of an error, and nothing retries because nothing failed.

**FIX TO MAKE (not yet implemented):** on the `--direct` pg client set `keepAlive: true` with a keepalive delay, a
finite `query_timeout` sized to the slowest known dimension with headroom (staging `vs_top_hitters` 254.9s, prod 151.6s
→ e.g. 20-30 min, not 0), and per-dimension progress logging so a stall is visible in the log rather than only in
`pg_stat_activity`. `statement_timeout=0` on the SERVER side is fine; it is the CLIENT-side infinite wait that is wrong.

**HOW TO DETECT A STALL (do this, don't guess):**
1. Compare the log's mtime to now — no output for >2× the slowest dimension = suspect.
2. Query `pg_stat_activity` on a SEPARATE connection: if there is **no active query**, the client is hung, not slow.
3. Check `pg_locks where not granted` — 0 means it is not a lock wait either.
4. Also check for STALE PROCESSES from earlier runs (`pgrep -f aggregate_pitch_log`) — an old staging run was still
   alive and competing for connections.

**RECOVERY (safe — stage 4 is idempotent):** kill the hung + stale processes, then re-run. Prefer re-running the FULL
set on prod rather than cherry-picking with `--only`/`--skip`: dimension rows that already exist may be STALE from the
pre-v2 process, and "rows exist" does NOT mean "rows are fresh". Steps 1-3 are unaffected — do NOT redo them.
**Nothing was corrupted by this stall.**

---
# 🧭 TRACK B — EXECUTION LESSONS FROM THE FIRST REAL RUN (staging + prod, 2026-08-29/30)
The 5-step chain has now been run END-TO-END on BOTH environments. Track B automates exactly this chain on ingest,
so every failure mode below WILL recur unattended unless Track B is built to handle it. This section is the
requirements list, written from what actually happened — not theory.

## ✅ WHAT WORKED (keep these properties)
- **Per-pitcher classification is deterministic.** Prod and staging produced an IDENTICAL label distribution to the
  tenth of a percent (4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1) and an
  IDENTICAL per-pitcher Stuff+ gate (mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7). Two independent datasets, same
  numbers ⇒ the classifier + scorer are reproducible. **Track B should assert this gate after every run.**
- **A hard SIGN CHECK that refuses to write** caught nothing because nothing was wrong — but it is the reason we can
  TRUST the armHB convention on both envs (18/18 buckets, twice). **Keep abort-before-write invariants.**
- **`is distinct from` + keyset + per-batch commit** made step 1 resumable and cheap to retry.
- **Backups before every destructive step** (`_v2_prechain_backup`, `_hm_prestep5_backup`, `_pm_prestep5_backup`) made
  the whole chain reversible. **Track B must snapshot before it writes, every run.**
- **Halt-on-failure between steps** stopped a quoting bug from cascading (it died before writing anything).

## ❌ WHAT BROKE — AND WHAT TRACK B MUST DO ABOUT IT
1. **STEP 3 DOES NOT RESUME.** `compute_pitch_log_stuff_plus.ts:185` re-scores every row matching the class version
   rather than filtering `stuff_plus IS NULL`, so each attempt costs the FULL runtime (staging 35.7 min, prod 29.9)
   and a mid-run failure leaves **v2 labels + STALE scores** — the one state that must never exist.
   → **TRACK B FIX: two phases — (a) score only `stuff_plus IS NULL`, (b) ALWAYS recenter across the FULL population**
   (the recenter needs every row to shift each bucket to mean 100, which is why naive resume is wrong).
2. **`--direct` REMOVES THE FAILURE SIGNAL.** `statement_timeout=0` + long `query_timeout` defeats the gateway's ~125s
   cut (required: `vs_top_hitters` needs 151-255s) but a dropped pooler connection then becomes an INFINITE HANG.
   Prod stage 4 sat **39 minutes with no output**, no active query, no locks. Nothing retried because nothing failed.
   → **TRACK B FIX: `keepAlive: true`, a FINITE `query_timeout` (~20-30 min, sized off the slowest dimension), and
   per-dimension progress logging.** Unattended automation CANNOT have an unbounded wait.
3. **EXIT CODE 0 ≠ SUCCESS.** `aggregate_pitch_log_dimensions.ts` exits 0 even when a dimension FAILED, and it HALTS
   on that failure so the 8 dimensions behind it never run. A run was wrongly marked COMPLETE this way.
   → **TRACK B FIX: validate by CONTENT (grep for the per-item success line + `FAILED`), never by exit code.**
4. **"ROWS EXIST" ≠ "ROWS ARE FRESH".** When `vs_top_hitters` failed, its table still showed 5,349 rows from the
   PRE-v2 run. A row-count check PASSES on stale data.
   → **TRACK B FIX: stamp a run/version marker on aggregate rows and verify FRESHNESS, not count.**
5. **`select *` VIEWS GO STALE SILENTLY.** Prod's `pitch_log_corrected` was frozen at 94/99 columns and did not expose
   `classification_version`, so the scorer hard-failed on prod while passing on staging. `create or replace` cannot
   fix it — it needs drop+create.
   → **TRACK B FIX: after ANY `ALTER TABLE pitch_log ADD COLUMN`, rebuild the view. Assert the view's column count
   matches the base table before the chain starts.**
6. **A LABEL CHANGE INVALIDATES EVERYTHING BELOW IT.** The §4.5 gyro floor moved 6-8% of breaking-ball volume, so every
   mix-dependent baseline/SD/percentile was invalid until regenerated.
   → **TRACK B FIX: steps 1→5 are ONE transaction-of-work. Never emit "done" between them.**
7. **ORDERING IS LOAD-BEARING AND WAS WRONG IN THE DOCS.** C26 must follow C27 (it reads `ncaa_averages` and falls back
   to hardcoded defaults SILENTLY when fields are missing); C29 must precede C28 (10 NJCAA rows are still tagged
   `division='D1'` and both C28 producers filter on it). Migration order for `team_season_stats` is by DEPENDENCY, not
   timestamp — the filenames sort wrong and fn-before-ALTER empties the table.
8. **UNORDERED `.range()` SILENTLY DROPS/DUPES ROWS.** Found in 6+ producers. A blanket `order("id")` is NOT the fix —
   `pitch_log_*_totals`, `player_season_defense` and `player_season_baserunning` have NO `id` column.
   → **TRACK B FIX: per-table PK map; refuse to paginate an unregistered table.**
9. **NEW-ROW CREATION WAS UNGATED.** `derive_masters_from_pitchlog` spread invented Master rows into the same upsert as
   the patches. The Masters are the TruMedia source of truth; a pitch-log-only row is a half-populated player.
   → **TRACK B FIX: never create Master rows implicitly. Opt-in only (`--create-new`), default OFF.**
10. **ENV GUARDS WERE MISSING OR WRONG.** One market script hardcoded `.env.local` (would resync STAGING while
    reporting success on a prod run); two others had NO guard at all and would write prod with zero opt-in; one had a
    STAGING build-id as its default scope, returning 0 rows on prod.
    → **TRACK B FIX: double-keyed guard everywhere — the URL and the `--prod` flag must AGREE, or refuse to run.**
11. **SEASON KEYS DIFFER BY PURPOSE.** 2026 = completed season (descriptive WAR), 2027 = projections. A query on the
    wrong season returns a misleading ZERO — this produced a false "staging has no WAR data" alarm.
    → **TRACK B FIX: every gate query must state its season explicitly and assert a non-zero denominator.**
12. **MACHINE SLEEP KILLED LONG RUNS.** Distinguish: environmental failures die at a DIFFERENT point each run;
    structural ones die at the SAME place with the SAME duration. Run detached with `caffeinate -dimsu -w <pid>`.

---
# 📐 TRACK B — EVERY VALUE THE CHAIN COMPUTES WITH (canonical list + where it lives)
Track B must not re-derive or guess ANY of these. Where a value lives in code, the code is authoritative and this is
the pointer + the current value so drift is detectable. Full detail: `docs/STUFF_PLUS_EXACT_VALUES.md`.

## STAGE 1 — CLASSIFIER (`src/savant/lib/stuffPlusClassifierV2.ts`) — 95.2% per-pitch / 95.3% arsenal-mix
Conventions: `armHB = (hand==="R" ? hb : -hb)` · `rr = ivb - |armHB|` · `gap = primaryFB_velo - pitch_velo`.
`primaryFB_velo` = mean velo of the pitcher's raw FA/SI if ≥3 such pitches, else mean of all his pitches.
**Per-pitch SEED (evaluation order is load-bearing):**
```
1  ivb <= -8  AND armhb < 4  AND gap >= 4            -> Curveball
2  armhb <= -12 AND ivb > -8 AND ivb <= 6            -> Sweeper
3  ivb >= 5 AND gap 2..7 AND armhb <= 2              -> Cutter
4  gap < 4:  rr > 4 -> 4S FB | rr < -4 -> Sinker | else -> FBSTRIP
5  |armhb| < 5 AND ivb -4..4                         -> Gyro Slider
6  armhb >= 5:  spin < 1400 -> Splitter | else -> Change-up      ★ FLOOR = 5
7  else                                               -> Slider
```
**Per-pitcher:** MERGE `|Δarmhb|<4 & |Δivb|<3.5 & |Δvelo|<2.5` **+ fastball-family guard (never merge differing
4S/Sinker/FBSTRIP seeds)** · FBSTRIP resolve: cluster mean `rr >= 0` -> 4S else Sinker · small-sample `<150` = means
only · ANCHOR = `n>=60 OR n>=0.10*total` · **§4.5 GYRO FLOOR: cluster labeled Slider with mean armHB >= -3 -> Gyro
Slider, applied BEFORE the step-4 backfill** · backfill fold: `moveDist<5 & |Δvelo|<3` into a strictly-LARGER anchor,
else non-anchor -> `needs_review` · tiebreaks: gyro/curve `|ar|<5 & -8<iv<-4` -> gap<=8 Gyro / >=10 Curve; CT/SL
ride-floor `iv>=5` -> Cutter.
⛔ NEVER re-derive: `rr > -1.7` FBSTRIP cut and the "arsenal rule" are LOGGED NEGATIVE RESULTS (both lose ~1pp).

## STAGE 2 — POP BASELINE (`pitcher_stuff_plus_ncaa`, per pitch_type × hand, **armHB**, D1-only)
Producer `scripts/derive_stuff_plus_pop_baseline.ts`. Stores mean + sd for: velocity, ivb, hb(armHB), rel_height,
rel_side, extension, spin, velo_diff(gap). **Hard sign check: arm-side (4S/SI/CH/SPL) POSITIVE and glove-side
(SL/SW/CB) NEGATIVE in BOTH hands, or it refuses to write.** MANDATORY after any reclass (the gyro floor moves 6-8% of
breaking-ball volume).

## STAGE 3 — THE 9 STUFF+ EQUATIONS (`src/savant/lib/stuffPlusEngine.ts`) — `score = 100 + weighted*20`
`z=(x-μ)/sd` · `zAbs=|x-μ|/sd` · `zMax=(max(x,μ)-μ)/sd`. **hb is armHB** (the `hbSign` multiplier was folded out in e5dec2f).
```
4S FB     0.30 z(velo) +0.25 z(ivb) +0.15 zAbs(armHB) +0.10 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.05 z(spin)
Sinker    0.30 z(velo) -0.20 z(ivb) +0.30 z(armHB)    +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext)
Cutter    0.30 zMax(velo) +0.15 z(ivb) -0.25 z(armHB) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.10 z(spin)
Gyro      0.30 zMax(velo) +0.15(-z(ivb)) +0.25((hb_sd-|armHB|)/hb_sd) +0.10 z(fbGap) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext)
Slider    0.15 zMax(velo) +0.10(-z(ivb)) -0.35 z(armHB) +0.10 z(fbGap) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.10 z(spin)
Sweeper   0.10 zMax(velo) -0.10 z(ivb) -0.40 z(armHB) +0.10 z(fbGap) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.10 z(spin)
Curveball 0.10 zMax(velo) -0.30 z(ivb) -0.15 z(armHB) +0.10 z(fbGap) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.15 z(spin)
Change-up 0.15 z(fbChVeloDiff) -0.20 z(ivb) +0.35 z(armHB) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.10 zAbs(spin)
Splitter  0.10 zMax(velo) -0.20 z(ivb) +0.25 z(armHB) +0.05 zAbs(relH) +0.05 zAbs(relS) +0.10 z(ext) +0.25(-z(spin))
```
Then **RECENTER each (pitch_type × hand) bucket to mean 100** — per-pitcher UNWEIGHTED, outliers (>140 / <60) excluded
from the calibration (`stuffPlusEngine.ts:450`). Per-pitch scores clamped to [40,160] BEFORE recenter.
Row filters: drop if `ivb` or `hb` NULL; drop if `ivb=0 AND hb=0 AND pitches<5`; drop if `pitches<5`.

## STAGE 4/5 — DOWNSTREAM CONSTANTS
Conference Stuff+ (V2, canonical) = pitch-weighted `Σ(pitcher Stuff+ × pitch count)/Σ(pitch count)`, FULL season.
`HTP = OPR + 1.25(Stuff+ - 100) + 0.75(100 - run_env)`.
`wRC+ = ((0.011 + 0.691·OBP + 0.235·SLG)/0.3782)·100`
`oWAR = ((((wRC+-100)/100)·PA·0.3994) + (PA/600·21.22)) / 13.1`
`pRV+ = 100 + 100·(6.913 - projRA9)/6.913`, `projRA9 = (3.847 - 0.231·K9 + 0.509·BB9 + 1.486·HR9)·1.137`
`pWAR = (((pRV+ -100)/100)·(IP/9)·6.915 + (IP/9·1.92)) / 13.1`
`total_hitter_war = o_war + d_war + bsr_war`
**RPW = 13.1** — VERIFIED stored in BOTH envs' `model_config`: `owar_runs_per_win=13.1`, `pwar_runs_per_win=13.1`
(and present 4× in the live `refresh_composite_war()` on prod). Do NOT hardcode 10.
56-game proration: `games_played_est ≈ team IP/9`, `factor = 56/games_played_est` capped **0.7–1.5**.
⚠ `computeAndStoreScores` reads baselines from `ncaa_averages` and falls back to HARDCODED defaults **silently** when a
field is missing — so C27 MUST run before C26, and Track B must assert the baselines exist before scoring.

## GATES TRACK B MUST ASSERT EVERY RUN
per-pitcher Stuff+ **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7** · every (type × hand) bucket recenters to **100.0**
· `needs_review ≈ 8.1%` · label distribution 4S 37.8 / SI 16.0 / SL 10.3 / GY 10.2 / CH 9.1 / CB 5.6 / SW 5.2 / FC 3.7
/ SPL 2.1 · `unscored = 0`.
