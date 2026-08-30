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
  - **On overwriting staging's labels — FINAL 2026-08-29: YES, OVERWRITE (standardize on v2 everywhere).** The anchor wins the residual 56/44, but that edge is only ~0.6% of the population and it is bought from a classifier with NO source code that can never be re-run or applied to prod. v2 is committed, versioned, re-runnable, and is what Track B needs on every ingest; one vocabulary + version stamp in BOTH envs beats a 0.6pp edge on an unreproducible process. Preserve `_reclass_result` as the historical reference. Superseded reasoning follows: Coherence partition (234 pitchers, 1,188 decidable disputes, run after all three fixes) = v2 closer 44.1% / anchor closer 55.9%. The anchor wins the residual; the "maybe v2 is right" hypothesis was REJECTED by measurement. (Prod is unaffected — it is on OLD CASE labels, which v2 beats decisively.) ⚠ Caveat: the partition does NOT cover the Gyro<->Slider pair (largest residual, 23,048) — centroid basis missing after the §4.5 fix. Original framing follows: "Agreement with the anchor" is NOT accuracy: the anchor is
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

---
## 🏆 PHASE-H CLEANUP — DO NOT DROP `_reclass_result` (2026-08-29)
Phase H lists Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these three:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Once staging is overwritten with v2 this is the SOLE way to ever
  measure against the old process. It is the regression baseline for every future classifier change.
- `_reclass_map` (37,101 rows) — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- `_reclass_pf` (4,804 rows) — per-pitcher primary-FB velo.
Safe to drop: `_reclass_fix` (transient writer staging table only).

---
# 🔴 STEP 4 (aggregate_pitch_log_dimensions) — GATEWAY TIMEOUT ON `vs_top_hitters`. Found on staging 2026-08-29/30.
**EVERY aggregation in this script runs through `exec_sql` over the HTTP gateway** (`aggregate_pitch_log_dimensions.ts:1035`
`await supabase.rpc("exec_sql", { sql })`). The gateway cuts the client at ~125s and the work is LOST.

## The deterministic failure
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`
**Reproduced EXACTLY twice** — same dimension, same error, same 125.3s duration. Not a dropped connection: that query
must resolve the top-quartile hitter set (~967 IDs) and filter ~2M pitches against it, which exceeds the gateway ceiling.
47 of 48 aggregations complete fine (~60-72s each); only this one is structurally too heavy for `exec_sql`.
⚠ **The script HALTS on the failure**, so dimensions 41-48 never ran either — one bad dimension blocks 9.

## WORKAROUND USED ON STAGING (Trevor's call)
1. `--skip=vs_top_hitters` to clear the other 47 (the `--skip` flag exists at `:953-954`, matched at `:1029`).
2. Run `vs_top_hitters` SEPARATELY over the **direct pg session** (`PGURI`) where there is no gateway timeout —
   the same pattern the reclassifier already uses for its big writes.

## ⚠⚠ PROD IMPLICATION — THIS WILL BE WORSE ON PROD, PLAN FOR IT
Prod is on a smaller compute tier with a more throttled disk, and prod's `exec_sql` has ALREADY been observed timing
out on far lighter queries. Do NOT assume the other 47 will clear on prod just because they did on staging.
**Recommended prod approach: run stage 4 over the direct pg session from the start**, not through `exec_sql`.
Budget generously and run it detached/unattended-safe.

## SEPARATE, ENVIRONMENTAL FAILURES SEEN THE SAME NIGHT (do not confuse with the above)
Three earlier failures were the LOCAL MACHINE sleeping / dropping its connection overnight, NOT script defects:
- staging insert during the v2 test: `TypeError: fetch failed`
- STEP 3 scoring died at 1,665,000/2,015,321 (~83%): `read ECONNRESET`
- STEP 4 first run died at 13/48, second reached 39/48
**Symptom that distinguishes them:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters`
failure dies at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED in the background and let them take however long they need,**
with `caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not
add aggressive retry loops.
⚠ STEP 3 (`compute_pitch_log_stuff_plus.ts`) is idempotent but does **NOT** resume — `:185` re-scores ALL rows matching
the class version rather than filtering `stuff_plus IS NULL`, so every attempt costs the FULL runtime (~36 min on
staging). A mid-run failure leaves **v2 labels + STALE scores**, the one state every doc says must never exist.

---
## 🔁 FUTURE WORK — MAKE THE CHAIN RESUMABLE (Trevor 2026-08-30). Not blocking, but valuable on PROD.
Resumability differs per step today:
| step | resumable? | why |
|---|---|---|
| 1 `reclassify_prod.ts` | ✅ FULLY | keyset on PK + `is distinct from` guards + `_reclass_fix` upserted by PK. Survives interruption; a re-run skips completed rows. |
| 4 `aggregate_pitch_log_dimensions.ts` | ⚠ MANUALLY | the 48 dims are independent and `--skip=` exists (:953-954, :1029), but you must pass the completed keys BY HAND. **FIX: auto-skip** — detect dims already written for this run-generation (e.g. compare a run marker / `updated_at` on the totals rows) and skip without being told. On staging each dim is ~60-72s so redoing 47 was cheap; on PROD it will not be. |
| 3 `compute_pitch_log_stuff_plus.ts` | ❌ NO — and it's the costliest to lose | :185 re-scores ALL rows matching the class version instead of filtering `stuff_plus IS NULL`. Every attempt costs the FULL runtime (~36 min staging, longer on prod), and a mid-run failure leaves **v2 labels + STALE scores**. |
**Why step 3 can't naively resume, and the fix:** the recenter pass must see the WHOLE population to shift each
(pitch_type × hand) bucket to mean 100 — scoring only the gaps would recenter against a partial set and be wrong.
Correct design = **two phases: (a) score only rows where `stuff_plus IS NULL`, then (b) ALWAYS run the recenter across
the full population.** That turns a 36-min restart into a few minutes while keeping the recenter exact.

---
# ▶️ RESUME HERE — STAGING CHAIN 95% DONE (2026-08-30). Read this block first.

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = 2,579,655 rows / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review 8.1%, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored=0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **45 of 48** refreshed + `populate_hitter_run_values(2026)` ✓. Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 · 4,234 pitchers.**
Prod must land within tolerance of this or ABORT.

## ⚠ OUTSTANDING ON STAGING
1. **3 × `vs_top_hitters` aggregations are STALE** — they failed twice (deterministic 125.3s gateway timeout) and were
   skipped on the successful run. ⚠ **`pitch_log_pitcher_totals` SHOWS `vs_top_hitters: 5,349` rows so the table LOOKS
   populated — those rows predate the v2 chain and are computed from OLD labels + OLD scores.** Must be re-run over the
   DIRECT pg session (`PGURI` in `.env.local`), not `exec_sql`.
2. **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY so far.** Dry run: **0 hitters** / **4,675 pitchers** would
   change (of 4,772 above-gate). Has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Run the 3 `vs_top_hitters` aggregations over the direct pg session (also = the PROD recipe for stage 4).
2. Review + apply step 5 (Masters) on staging.
3. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
4. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
5. Prod chain: reclassify → baseline → score → aggregate (**direct session from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the CORRECTED pitch_log lane.

## ⏱ REALISTIC TIME ESTIMATE FOR THE PROD RUN
Staging actuals: step 1 ≈ **75 min** (load+classify+2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**.
**Staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already times
out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in ONE sitting with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split, because
a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (re-scores everything matching the class version), so any interruption costs the FULL
runtime again. Consider building the two-phase fix (score only NULLs → always recenter all) BEFORE the prod run.

---
# ✅ SOLVED — STEP 4 `vs_top_hitters`: USE `--direct`. (staging-proven 2026-08-30)
**Root cause CONFIRMED, not theorised:** the query is not broken, it is simply LONGER than the HTTP gateway allows.
Over `exec_sql` it failed **twice, deterministically, at exactly 125.3s**. Over the DIRECT pg session the SAME query
**succeeded in 253.2s** — i.e. it needs ~2× the gateway's ~125s ceiling. Nothing else changed.

## THE COMMAND (staging)
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
## ⚠⚠ THE COMMAND FOR PROD — RUN THE WHOLE OF STEP 4 WITH `--direct`, NOT JUST THIS DIMENSION
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
**Reasoning:** `vs_top_hitters` already needs 253s on STAGING. Prod is a SMALLER compute tier with a MORE throttled
disk (expect ~8-10 min for that one dimension), and prod's `exec_sql` has ALREADY been observed timing out on lighter
queries. Through the gateway this dimension would fail on prod **100% of the time**, and the script HALTS on failure,
so it would also block the 8 dimensions that come after it. `--direct` is NOT a staging workaround — it is the
REQUIRED path on prod.

## NEW FLAGS ADDED TO `aggregate_pitch_log_dimensions.ts` (2026-08-30)
- **`--direct`** — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling) instead of
  `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs which path is used.
- **`--only=<keys>`** — mirrors `--skip=`; runs ONLY the named dimension(s). Makes step 4 targetable, so a single
  failed dimension can be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- (existing) **`--skip=<keys>`** — skip named dimensions.

## ⚠ THE TRAP THIS CREATED — A STALE DIMENSION THAT LOOKS POPULATED
When `vs_top_hitters` failed, `pitch_log_pitcher_totals` still SHOWED **5,349 rows** for that `dimension_key` — rows
left over from a PRE-v2 run, computed from OLD labels and OLD Stuff+ scores. **A row-count check would have passed.**
→ After ANY reclassification, verify a dimension by FRESHNESS (did this run write it?), never by row count.
→ Related: the script **exits 0 even when a dimension FAILED** — validate by CONTENT (grep the log for `FAILED` and
for the per-dimension `ok`), never by exit code. A run was wrongly marked COMPLETE this way on 2026-08-29.
