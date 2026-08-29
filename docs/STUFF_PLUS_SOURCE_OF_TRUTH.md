# STUFF+ — SOURCE OF TRUTH (TOP DOG vs LEGACY). 2026-08-29.

**Read this before touching anything Stuff+.** It supersedes the Stuff+ sections of every earlier handoff, audit, and
agent-learnings doc. Where an older doc disagrees with this file, **this file wins** and the older doc is wrong.

Verified empirically on staging 2026-08-29 (not inferred from docs — the earlier docs were written during a period of
confusion and contained wrong conclusions).

---

## 1. THE TWO LANES

### ★ TOP DOG — the pitch_log lane (LIVE, correct, the number coaches see)
```
pitch_log (per-pitch, venue-corrected)
  → pitch_type_reclassified          [anchor classifier, stamped v1-anchor-2026-08-17]
  → compute_pitch_log_stuff_plus.ts  [normalizes hb → armHB, scores per pitch]
  → pitch_log.stuff_plus
  → aggregate_pitch_log_dimensions.ts
  → pitch_log_pitcher_totals / pitch_log_pitcher_by_pitch_type  (stuff_plus_sum / data_pitches)
  → DISPLAYS: Season Stats (PitchLogSection) + PitcherProfile arsenal table
```
**Convention: armHB throughout.** Rows are normalized (`RHP hb / LHP −hb`) in `compute_pitch_log_stuff_plus.ts` (~line 200),
the pop baseline `pitcher_stuff_plus_ncaa` is armHB-derived (VERIFIED: CH R +14.93 / L +14.87, SL R −6.49 / L −6.83 — same
sign both hands), and the 9 equations are "folded" to expect armHB. **Fully self-consistent. No bug.**

### ⚠ LEGACY — the CSV / PSP-I lane (superseded; fallback only)
```
TruMedia CSV → importStuffPlusInputsCsv → pitcher_stuff_plus_inputs   [stores RAW hb]
  → runStuffPlusPipeline (in stuffPlusEngine.ts)   ✗ passes RAW hb to armHB-expecting equations
  → rollupStuffPlusToMaster → "Pitching Master".stuff_plus            ✗ stale / wrong / nothing reads it for 2026
```
Only still used for: **prior seasons (≤2025)** and **JUCO** (no JUCO pitch logs exist). For 2026 D1 it is **not read**:
`PitcherProfile.tsx:664` ("PITCH_LOG Switch #1, 2026-06-23") skips PSP-I entirely for 2026 when pitch_log has rows.

---

## 2. THE LATENT BUG IN THE LEGACY LANE (do not "fix" the live lane for this)
Commit `e5dec2f` (2026-08-17) removed the `hbSign = hand === "L" ? -1 : 1` multiplier from all 7 HB-signed equations,
because the NEW pitch-log caller normalizes to armHB itself. The OLD aggregate caller (`runStuffPlusPipeline`) was never
updated and still passes RAW hb. **Consequence if run: left-handers are scored backwards** (a bigger lefty sweeper is
penalized). PROVEN: current code gives Slider R −0.979 / L −0.976 (same sign = broken); the stored pre-Aug-17 data gives
R −0.859 / L +0.883 (mirrored = correct).
- **NOT live.** Nothing has run that path since Aug 17, so no displayed number is affected. `e5dec2f` is only on
  `feature/war-recalibration`, not main.
- **Fix when/if the legacy lane is revived:** normalize raw→armHB in memory inside `runStuffPlusPipeline` (mirroring the
  pitch-log path). **Do NOT rewrite the stored `hb` column** — it is raw by design, displayed by the UI, and written raw
  by the CSV importer. armHB is a COMPUTE convention, not a STORAGE convention.

---

## 3. THREE DIFFERENT "Stuff+" NUMBERS EXIST — know which you're looking at
Measured for Dylan Volantis (`source_player_id 1979617275`), staging 2026:

| value | source | verdict |
|---|---|---|
| **107.62** | `pitch_log_pitcher_totals[all]` | ★ **THE REAL ONE** — what displays |
| 104.93 | `"Pitching Master".stuff_plus` | stale old master upload, never updated — ignore |
| 115.2 | pitch-weighted rollup of `pitcher_stuff_plus_inputs` | legacy lane, not displayed |

If a doc or script quotes a Stuff+ number, confirm which of these it means before trusting it.

---

## 4. CLASSIFIER: what is real
- `pitch_log.pitch_type_reclassified` on staging = **2,005,666 rows** stamped `v1-anchor-2026-08-17`, produced by the
  **anchor classifier** (its source code was lost — scratchpad only). These labels are the VALIDATED product.
- `breakingBallReclassification.ts` (legacy lane) writes `rstr_pitch_class` on PSP-I and **has never touched pitch_log**.
  It is a DIFFERENT thing from the anchor classifier. Conflating the two caused a full day of wasted work (2026-08-28/29).
- **v2** (`src/savant/lib/stuffPlusClassifierV2.ts` — the SINGLE source; `scripts/reclassify_v2.ts` is only a validation
  harness and no longer carries its own copy) is a clean-room RECONSTRUCTION of the lost anchor classifier.
  **ACCURACY: 1,885,862 / 2,000,674 = 94.3% per-pitch** (full population) · arsenal-mix 94.3% · needs_review 8.1%,
  **+ the §4.5 gyro fix (+0.96/+1.24pp measured on two disjoint samples) → projected ~95.3-95.4%.**
  ⚠ The older "92.6% / 90.5%" figures are STALE — they predate the three 2026-08-29 fixes AND were measured against a
  duplicate copy of the classifier that has since been deleted.
  - The cross-arm-side errors previously cited here (`Gyro Slider → Change-up`, `Slider → Change-up`) are **FIXED** by
    the offspeed armHB≥5 floor and the §4.5 gyro floor. See `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
  - **On overwriting staging's labels — SETTLED 2026-08-29: DO NOT.** Coherence partition (234 pitchers, 1,188 decidable disputes, run after all three fixes) = v2 closer 44.1% / anchor closer 55.9%. The anchor wins the residual; the "maybe v2 is right" hypothesis was REJECTED by measurement. (Prod is unaffected — it is on OLD CASE labels, which v2 beats decisively.) ⚠ Caveat: the partition does NOT cover the Gyro<->Slider pair (largest residual, 23,048) — centroid basis missing after the §4.5 fix. Original framing follows: "Agreement with the anchor" is NOT accuracy: the anchor is
    the previous classifier's output, not truth, so the residual ~4.7% mixes v2-wrong, **v2-RIGHT-anchor-wrong**, and
    coin-flips. Partition it with `scripts/v2_coherence_test.ts` BEFORE deciding. If v2 wins a meaningful share, staging's
    labels are the ones that should be updated. (Coherence pre-fixes read 55.1/44.9 for stored on 1,443 disputes; after
    the merge guard 40.1/59.9 on a smaller/harder 818-dispute residual. Re-run it after the gyro fix.)
  - v2's confirmed purpose: the committed, **re-runnable forward classifier** for PROD (whose pitch_log carries only the
    OLD per-pitch CASE labels) and for Track B on-ingest — the original anchor code no longer exists.

---

## 5. COVERAGE FACTS (measured, not assumed)
- `pitch_log` is **D1-only**. `pitcher_stuff_plus_inputs` covers **7,012** pitchers; pitch_log covers **5,303** (all D1).
- The **1,709** pitchers with PSP-I rows but no pitch_log are **1,627 NJCAA_D1 + 81 D1 + 1 D2**.
  → Deriving inputs from pitch_log alone silently drops all JUCO. JUCO stays CSV-derived (scored vs D1 baselines).
- PSP-I and pitch_log are different pitch populations even for matched pitchers (~11.4 fewer pitches/row in pitch_log).

---

## 6. FILE MAP — top dog vs legacy
**★ TOP DOG (pitch_log lane):** `scripts/compute_pitch_log_stuff_plus.ts` · `scripts/aggregate_pitch_log_dimensions.ts` ·
`src/savant/lib/stuffPlusClassifierV2.ts` · `scripts/reclassify_prod.ts` (prod label writer) ·
`pitch_log_pitcher_totals` / `_by_pitch_type` tables · `src/savant/hooks/usePitchLog*` · `src/savant/components/PitchLogSection.tsx`.

**⚠ LEGACY (CSV/PSP-I lane — fallback for ≤2025 + JUCO):** `breakingBallReclassification.ts` ·
`runStuffPlusPipeline` (in `stuffPlusEngine.ts`) · `rollupStuffPlusToMaster.ts` · `pitcher_stuff_plus_inputs` ·
`"Pitching Master".stuff_plus` · `scripts/recompute-stuff-plus.ts` · `scripts/recompute-stuff-scoped.ts`.

**SHARED (do not label either way):** the 9 scoring equations + `calculateStuffPlus` in `stuffPlusEngine.ts`, and the
`pitcher_stuff_plus_ncaa` pop baseline — both lanes use these. Equations expect **armHB**.

**DELETED 2026-08-29 (were dead, zero importers):** `ReclassificationRunner.tsx`, `StuffPlusRunner.tsx`,
`StuffPlusRollupRunner.tsx`, `scripts/_reclass_rollout.ts`, `scripts/reclassify_pitch_log.ts`,
`scripts/_run_reclassify_bare.ts`, `scripts/_run_reclassify_chunked.ts` (+ their npm scripts).

**SAVANT guardrail:** `src/savant/pages/*` deleted (the scrubbed feature). `src/savant/components|hooks|lib` are
**LOAD-BEARING** for the live Season Stats display — do NOT delete.

---

## 7. TRACK B (target) — one chain, pitch_log as source of truth
Ingest pitch_log (weekly/biweekly, local folder) → classify (v2) → derive baseline → score per pitch → aggregate to
totals/by_pitch_type → power ratings → conference baselines → projections. Master-sheet uploads come later as a CHECK and
to override only what pitch_log cannot produce (e.g. AVG/SB). Numbers referenced here: `docs/STUFF_PLUS_EXACT_VALUES.md`.

---
## ★★★ STUFF+ v2 CLASSIFIER — CURRENT STATE + CONCLUSIONS (2026-08-29). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**ACCURACY vs the anchor ground truth (`_reclass_result`, all 4,804 pitchers / 2,000,674 pitches):**
`1,885,862 / 2,000,674 = 94.3% per-pitch` · arsenal-mix 94.3% · needs_review 8.1% — **+ the §4.5 gyro fix (measured
+0.96pp / +1.24pp on two disjoint samples) → projected ~95.3-95.4%.** Supersedes the stale 92.6%, which predated the
fixes AND was measured against a DUPLICATE copy of the classifier that has since been deleted.

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied BEFORE `tiebreak()` (ordering is worth
   ~+0.3pp). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero fastball/offspeed regression.

**TWO NEGATIVE RESULTS — do NOT redo these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the PREVIOUS classifier's output (a lost scratchpad
implementation), not truth. The residual ~4.7% mixes (a) v2 wrong, (b) **v2 RIGHT and the anchor wrong**, (c) coin-flips.
Partition it with `scripts/v2_coherence_test.ts` before treating any of it as error. If v2 wins a meaningful share, the
"do NOT overwrite staging's labels" guidance REVERSES.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 rows, NO
`classification_version` stamp, `needs_review` all null, no `_reclass_fix` table) — **v2 has NEVER written to prod**; the
prior prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130
pitches = 29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**),
correcting prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI +
an explicit "prod, now?" and MUST be followed immediately by the Stuff+ recompute chain.

---
## ★★★ TRACK B — STUFF+ STAGE, LOCKED SPEC (2026-08-29). Supersedes any earlier Stuff+ description here.
Track B = ONE function on pitch-log ingest (weekly/biweekly, local folder watch). Master-sheet uploads come LATER as a
CHECK + to override only what pitch_log cannot produce (e.g. AVG/SB). **pitch_log is the SOURCE OF TRUTH.**

**THE STUFF+ STAGE — exact order. Steps 1→5 MUST complete in ONE run; a label change invalidates every number below it.**
1. **CLASSIFY** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `src/savant/lib/stuffPlusClassifierV2.ts` (v2 — the SINGLE classifier), driven by `scripts/reclassify_prod.ts`.
2. **RE-DERIVE the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider, so every
   mix-dependent artifact (baselines, D1/regional means + SDs, pitch-shape percentiles) is invalid until regenerated.
3. **SCORE per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100).
4. **AGGREGATE** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts` (must also call `populate_hitter_run_values(season)`).
5. **MARRY ONTO THE MASTERS** → `scripts/derive_masters_from_pitchlog.ts`
   (⚠ add `.order(PK)` to its `readAll` first — unordered `.range()` over ~2.5M rows silently drops/dupes).
Then: power ratings → conference baselines → projections → market/NIL.

**⛔ WHAT TRACK B MUST NEVER DO**
- NEVER route Stuff+ through the LEGACY lane: `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
  `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. Nothing reads it for 2026 and it carries the latent
  raw-HB bug (e5dec2f removed `hbSign`; PSP-I stores RAW hb ⇒ left-handers scored BACKWARDS).
- NEVER call `legacy_breakingBallReclassification` (v1). It writes `rstr_pitch_class` on PSP-I, has never touched
  pitch_log, and is NOT the anchor classifier. Conflating the two cost a full day (2026-08-28/29).
- NEVER rewrite the stored `hb` column to armHB. `hb` is RAW by design (UI displays it; the CSV importer writes it raw).
  armHB is a COMPUTE convention — normalize in memory only.
- NEVER leave new labels with stale scores. Steps 1→5 are one transaction-of-work.

**LANE COVERAGE (measured):** `pitch_log` is **D1-only** — 5,303 pitchers. PSP-I covers 7,012; the 1,709 difference is
**1,627 NJCAA_D1 + 81 D1 + 1 D2**. → **JUCO has no pitch logs and stays CSV-derived** (scored vs D1 baselines). Track B's
pitch_log chain covers D1 only; do not let it silently drop JUCO. JUCO process is being restarted separately.

**CLASSIFIER STATE FEEDING TRACK B (2026-08-29):** v2 = **94.3% per-pitch** on the full 2,000,674-pitch anchor set
(arsenal-mix 94.3%, needs_review 8.1%), **→ projected ~95.3-95.4%** with the §4.5 gyro floor. Three shipped fixes:
offspeed `armHB >= 5` floor · fastball-family MERGE GUARD (>60% of 4S↔Sinker errors) · §4.5 gyro cluster floor `-3`
applied BEFORE `tiebreak()`. Two logged NEGATIVE results — `rr > -1.7` and the "arsenal rule" confound (loses ~1pp) —
do NOT rebuild either. Full numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11. Lane map: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the previous classifier's output, not truth. The residual
~4.7% mixes v2-wrong / **v2-RIGHT-anchor-wrong** / coin-flips — partition with `scripts/v2_coherence_test.ts` before
treating it as error, and before deciding whether staging's labels should be updated rather than preserved.
