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
- **v2** (`src/savant/lib/stuffPlusClassifierV2.ts`, from `scripts/reclassify_v2.ts`) is a clean-room RECONSTRUCTION of the
  lost anchor classifier: **92.6%** vs `_reclass_result`, **90.5%** vs the stored pitch_log labels, and consolidates
  slightly (5.85 → 5.54 distinct labels/pitcher).
  - ⚠ v2 is **NOT** an upgrade to staging's labels. Some of its disagreements are errors (`Gyro Slider → Change-up` 156,
    `Slider → Change-up` 39 — cross-arm-side moves that should not happen). **DO NOT overwrite staging's
    `pitch_type_reclassified` with v2.**
  - v2's real purpose: a committed, **re-runnable forward classifier** for PROD (whose pitch_log has no labels) and for
    Track B on-ingest — because the original anchor code no longer exists.

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
