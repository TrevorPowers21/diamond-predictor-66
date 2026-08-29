# STUFF+ — EXACT VALUES (single source of truth). 2026-08-28.
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


**Every number we decided, in one place.** Classifier thresholds, algorithm gates, the 9 scoring equations, the derived
ranges, validation results. Source code: `scripts/reclassify_v2.ts` (classifier) + `src/savant/lib/stuffPlusEngine.ts` (scoring).
`classification_version = "v2-ranges-2026-08-28"`.

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

## 7. VALIDATION (honest diverse 120-pitcher sample, vs staging `_reclass_result`)
- Per-pitch match: **92.6%**. Arsenal-mix overlap: **93.0%**. needs_review: **8.6%**.
- **STUFF+ CROSS-CHECK** (`--stuffcheck`, per-pitcher overall Stuff+, v2 vs staging labels, same equations): **|Δ| mean 0.85, p50 0.44, p90 1.95; within ±1 = 78%, ±2 = 91%, ±3 = 96%.** → classification difference is product-invisible.
- Session arc: 85.2% (box-rules) → 87.8% (FBSTRIP) → 91.5% (derived ranges) → 92.6% (seam-local backfill).

## 8. A2 PROD DRY-RUN (`reclassify_prod.ts --dry-run`, read-only, prod trbvxuoliwrfowibatkm)
2,013,005 labels; needs_review 8.6%. Distribution (prod vs staging): 4S 37.7/37 · SI 16.1/16.5 · SL 11.1/14 · CH 10.6/9 · GY 7.9/6.4 · CB 5.6/5.7 · SW 5.2/5.6 · FC 3.7/3.6 · SPL 2.1/2.3. (SL/GY/CH = the known seam bleed; fastballs/SW/CB/FC/SPL dead-on.)

## 8b. FULL-POPULATION PER-ROW STUFF+ CALC (`reclassify_v2.ts --score`, staging, READ-ONLY, 2026-08-28)
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
- Classifier: `scripts/reclassify_v2.ts` (modes: --validate/--derive/--mismatches/--pitcher/--stuffcheck). A2 writer: `scripts/reclassify_prod.ts`.
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
