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

### 11.7 ★ FULL-POPULATION VALIDATION (2026-08-29) — the authoritative accuracy number
`reclassify_v2.ts --validate --sample 4804` — ALL 4,804 pitchers, ALL 2,000,674 pitches vs `_reclass_result`.
FIRST run measured against the REAL classifier (scripts/reclassify_v2.ts previously carried a DUPLICATE copy of the
classifier; it now imports src/savant/lib/stuffPlusClassifierV2.ts — that duplication is why earlier numbers drifted).

**1,885,862 / 2,000,674 = 94.3% per-pitch  |  ARSENAL-MIX overlap 94.3%  |  needs_review 8.1%**
(supersedes the stale 92.6%, which predated both fixes AND was measured on the duplicate copy)

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
→ IF v2 wins a meaningful share of the residual, the earlier "do NOT overwrite staging's labels" guidance REVERSES —
staging's anchor labels would be the ones needing updating. That guidance assumed the anchor was better; it may not survive measurement.

### 11.10 ★ CONFIRMED FULL-POPULATION ACCURACY AFTER THE GYRO FIX (2026-08-29)
`--validate --sample 4804`, ALL 2,000,674 pitches vs `_reclass_result`:
**1,903,348 / 2,000,674 = 95.1% per-pitch  |  arsenal-mix 95.2%  |  needs_review 8.1%**
(was 94.3% / 94.3% / 8.1% before §4.5 → **+0.8pp**, total errors **114,812 → 97,326**, −17,486.
Slightly under the +1.09pp sample projection — samples were mildly optimistic. This 95.1% is the CONFIRMED number;
replace any "projected ~95.3-95.4%" wording with it.)
Confusions after (vs before): `Gyro→Slider` **25,197 → 7,210 (−71%)** · `Gyro→Cutter` 6,641 → 4,350 ·
`Slider→Gyro` 13,071 → 15,838 · `Sweeper→Slider` 8,136 → 8,114 · **`4S→Sinker` 12,614 → 12,614 and
`Sinker→4S` 14,184 → 14,184 — BYTE-IDENTICAL, zero fastball regression, exactly as predicted.**
Gyro/Slider pair total 38,268 → 23,048 (−40%) but still the largest bucket; v2 now slightly OVER-calls gyro
(`Slider→Gyro` is now the single biggest confusion) — the residual seam is symmetric-ish, not one-directional.

### 11.11 ★ COHERENCE PARTITION OF THE RESIDUAL (2026-08-29) — SETTLED: do NOT overwrite staging
`scripts/v2_coherence_test.ts --sample 250`, run AFTER all three fixes (v2 at 95.1%). Unbiased design: centroids built
ONLY from pitches both labelings agree on, then each disputed pitch scored by distance to its v2-label vs anchor-label centroid.
**234 pitchers | 102,872 agreed | 1,308 disputed → v2 closer 524/1,188 = 44.1% · ANCHOR closer 664/1,188 = 55.9%**
→ **The residual ~4.9% is NOT mostly "v2 right / anchor wrong."** The anchor wins it ~56/44. The hypothesis that
agreement-below-100% might largely be v2 IMPROVING on the anchor is REJECTED by measurement.
→ **DECISION (now settled, no longer open): do NOT overwrite staging's `pitch_type_reclassified` with v2.**
  This REVERSES the "open pending coherence" framing in SOURCE_OF_TRUTH §4.
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

### 11.12 ★★★ DECISION REVERSED (2026-08-29, Trevor): STANDARDIZE ON v2 EVERYWHERE — overwrite staging too
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

---
## 🏆 PHASE-H CLEANUP — DO NOT DROP `_reclass_result` (2026-08-29)
Phase H lists Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these three:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Once staging is overwritten with v2 this is the SOLE way to ever
  measure against the old process. It is the regression baseline for every future classifier change.
- `_reclass_map` (37,101 rows) — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- `_reclass_pf` (4,804 rows) — per-pitcher primary-FB velo.
Safe to drop: `_reclass_fix` (transient writer staging table only).
