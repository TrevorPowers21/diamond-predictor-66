# Stuff+ Classification + Calibration Edit — PLAN (2026-08-16)

Branch `feature/war-recalibration`. Context/receipts: `docs/TRANSFER_ENGINE_AUDIT_2026_08_13.md` §Bucket 3 + 3b.
Memory: `project_transfer_engine_audit`, `feedback_stuff_plus_*`.

## Why this is its own edit, and why NOW (before the recompute)
Stuff+ is the **competition-translation currency**: it measures a pitcher's talent, rolls up to **conference pitching
depth** baselines, and is the **opposing-quality lever** in the transfer engine (hitters vs destination pitching Stuff+;
pitchers vs HTP, built from Stuff+). So Stuff+ errors propagate into wrong transfer/recruiting projections everywhere.
The classification + calc fixes CHANGE Stuff+ scores → they must be finalized **before the Step-6b transfer recompute**,
so projections land on the final numbers **once** (resolves "don't change outputs twice" — do Stuff+ right, then recompute).
The math itself was verified trustworthy (audit §3b); this edit is **classification + two calc bugs + pipeline
consolidation**, not a rebuild.

## THE PLAN (sequence — Trevor 2026-08-16)

### 1. Fix Stuff+ classification (the heart)
Reclassify off **movement + velo-separation, NOT the incoming TrackMan tag.** ⚠ **TrackMan auto-tags by VELOCITY** — a
slow pitch is labeled "Change-up" regardless of shape, a hard one a fastball — so the source `pitch_type` is unreliable.
- **Fastball/offspeed family reclassifier (NEW — none exists today):** 4S FB vs Sinker vs Cutter vs Change-up from
  IVB/HB/velo (+ **velo-separation from the pitcher's own fastball** to catch true change-ups, incl. low-velo "fastballs"
  that tumble). Today only `breakingBallReclassification.ts` exists (breaking balls only) — extend that pattern.
  - **WHY it compounds:** sinkers tagged 4S are double-penalized — scored on ride-heavy 4S criteria (low ride looks
    "bad") AND they pollute the 4S population so "average" is dragged down. Pulling them out **helps BOTH**: true 4S guys
    score better vs a cleaner (higher-ride) baseline, and sinkers finally get scored as sinkers (arm-side run + drop).
- **Revisit breaking-ball / gyro thresholds:** Trevor — "**0 HB, −6 IVB = a dope gyro slider**." Classification and
  scoring are designed together (what gets CALLED a gyro pairs with the calc rewarding its depth).
- **Method (revised after external review 2026-08-16 — details in the agent-learnings doc):**
  0. **Venue/sensor-variance check FIRST** — per-venue mean IVB/HB residuals off pitcher-season means (visiting-pitcher
     logic, like the framing park fix); if any park ≥ 1.5″ offset, correct BEFORE classifying. One query; makes every
     threshold trustworthy.
  1. Pull the IVB/HB/velo distributions (`pitcher_stuff_plus_inputs`), **per-pitcher cluster** (≥~150–300 pitches; below →
     global boundaries on the pitcher's cluster MEANS, never per-pitch). **Label at the cluster level.**
  2. **Classify SWEEPER out first**, then set the Cutter/Slider boundary on what remains — velo-gap cut at the cluster
     VALLEY (~6 mff per review, CONFIRM on our data) + **binary arsenal tiebreaker** (2nd breaking ball → Cutter, else
     Slider) for the ambiguous band.
  3. 4S/Sinker split on **release-height-conditioned IVB bands** (low slots ride less); **verify HB is handedness-
     normalized first** (one-line check, else lefty sinker condition silently fails). Sweeper threshold gets the same
     release-height guard (sidearmers).
  4. **Validation loop** — spot-check a known sinkerballer, a true 4S guy, a change-up guy, the 0-HB/−6-IVB gyro; log the
     two known-ambiguous archetypes (86–88 cutter-shaped slider; low-slot sinker/4S straddler) with documented tiebreaker,
     do NOT let them block the build. Rule-based + `needs_review` flags (like the breaking-ball reclassifier).

### 2. Fix the equation bugs (calc)
- **Curveball HB sign** — `stuffPlusEngine.ts:247` has `hbSign·(−0.15)·zh`; a glove-side curveball is penalized while
  Sweeper (the other glove-side breaker) is `+0.40`. Flip curveball's coefficient positive. (Trivial, one token.)
- **Gyro slider VB** — `calcGyroSlider` (`:173`): reward vertical depth (pair with the gyro classification threshold
  above). Confirm exact form when we build it.

### 3. Run it
Recompute Stuff+ (`scripts/recompute-stuff-plus.ts` / the engine): re-score all pitches on the new classification +
fixed calcs, recenter each (pitch_type × hand) bucket. Weighting fork (unweighted vs pitch-weighted recenter) stays
as-is (unweighted) for this pass unless it surfaces — not the priority.

### 4. Set it up to run + STORE (the one process)
Fold compute+store into the **pitch-log process and nothing else** (the theme: clear-then-build, one correct method — no
scattered scripts):
- **Conference Stuff+** = V2 pitch-weighted (every pitcher weighted by pitch totals) — canonical. **Retire V1**
  (per-pitcher-composite, name-keyed).
- **Per-player Stuff+** stored to the Pitching Master.
- Compute on upload (retire the one-off scripts `conferenceStuffPlusV2`, `populate-conference-stats-env-plus`); collapse
  the 2 composite + 2 baseline writers to one each. Ties toward the unified pitch-log→projection function (Track B).

### 5. → Next step
The recompute chain — **Step 6b → 7b → 7c → 7d → Step 8 prod** — runs on the FINAL Stuff+ (so transfers reflect the
corrected classification + calcs). NIL's remaining wiring (score→total_hitter_war + need premium) rides 6b/7c per
`HANDOFF_NIL_2026_08_16.md`.

## THE PARTITION — classification spec v1 (Trevor 2026-08-17, + agent improvements)
Exhaustive partition over **(gap, armHB, IVB)** with **spin** deciding CH/SPL. **10 primary buckets, each its own
equation** — so a below-average pitch grades poorly *inside its correct room* instead of being exiled to the wrong one
(the whole thesis). Boundary rules give the primary label; **nearest-centroid** (data-derived bucket centers, post
venue-check) is the fallback for boundary/low-confidence pitches; low-confidence flag + exceptions log; **NEVER defaults
to slider.**

**Conventions (agent fix — the spec mixed two; unify before coding):**
- **`armHB`** = HB handedness-normalized to **arm-side-positive** (+ = arm-side run, − = glove-side break). "Glove-side
  break" = `−armHB`. Every rule below reads `armHB`. (This IS the handedness audit, concrete.)
- **`gap`** = `primaryFB_velo − pitch_velo`, where **primaryFB = the pitcher's HARDEST fastball-family cluster**. Two-pass
  per pitcher: identify primaryFB first (gap 0), then gap-classify the rest.
- **First cut for off-fastball pitches (gap ≳ 4):** `armHB > 0` (arm-side) → **OFFSPEED family**; `armHB ≤ 0`
  (glove-side/neutral) → **BREAKING family**. Resolves the gap-range overlaps.

**FASTBALL family** (gap 0–3, or the primary itself):
- **Four-seam:** ride-dominant, `IVB − |armHB| > +4`. Small glove-side at FB gap stays 4S (earns the ABS|IVB| cut-ride reward).
- **Sinker:** run-dominant, `IVB − |armHB| < −4`, arm-side. Middle strip [−4,+4] by cluster mean; rel_height tiebreaker only.

**CUTTER** (gap 0–6): glove-side cut (`armHB` down to ~−6), **ride retained (IVB ≥ +5)**, FB timing. **CT/SL seam (gap
6–8): IVB ≥ +5 → cutter, IVB < +5 → slider**, + arsenal tiebreaker.

**SLIDER family** (gap ~5–11, glove-side/neutral):
- **Gyro slider:** `|armHB| < 5`, `IVB ∈ [−4, +4]`. The bullet (incl. gravity-ball negatives).
- **Slider:** glove-side `armHB ∈ [−11, −5]`, `IVB ∈ [−5, +4]`; + the ride-retaining low-HB "slutter" corner (IVB ~7 /
  |armHB| ~2 at slider gap) = **display sub-flag** [OPEN: grade with cutter eq if IVB ≥ +5?].
- **Sweeper:** glove-side `armHB ≤ −12`, `IVB ∈ [−2, +6]`, gap 8–13. **HB bar slot-conditioned** (sidearm sliders sweep
  12+ from arm angle alone — else they mis-tag sweeper).

**CURVEBALL family** (gap 12+ as the family line, OR `IVB ≤ −8` at any gap — topspin-forces-entry blend rule):
- **12-6 Curveball:** `IVB ≤ −8`, `|armHB| < ~8`. Topspin downer. Also receives the hard low-gap sub-−8 pitches (graded a hard curve).
- **Sweeping Curveball:** `IVB ≤ −8`, glove-side `armHB ≤ −8`. Two-plane breaker at curve velo (slider's mirror one shelf
  down). Sweeper↔sweeping-curve seam: sweeper holds `IVB ∈ [−2,+6]`; below −8 with big HB at gap 12+ = sweeping curve;
  the −2→−8 / gap 10–13 overlap by cluster mean.

**GYRO/CURVE BLEND STRIP** (`|armHB|` low, `IVB ∈ [−8, −4]`): gap ≤8 → gyro, gap ≥10 → curve, 8–10 by cluster mean +
arsenal. `IVB > −4` → gyro regardless of gap; `IVB < −8` → curve regardless.

**OFFSPEED family** (arm-side, gap ~6–14):
- **Changeup:** spin held (`≥ ~1600`), arm-side fade, IVB typically positive.
- **Splitter:** killed spin (`< ~1400`), `IVB < ~3`, tumble.

**RESOLVED (Trevor 2026-08-17):**
- **9 equation-buckets** (FF, SI, CT, gyro, SL, SW, **CB (one, both shapes)**, CH, SPL). **The two curves are ONE bucket**
  — split-test = split only when one formula would MISGRADE a legitimate shape. Sliders needed it (sweep vs bullet-depth
  are OPPOSING virtues under one formula); curves do NOT (depth and sweep are both just "break at curve velocity", not
  opposing), and the sign-fixed curveball eq (`−0.30·z(ivb)` pays depth, `+0.15` glove-side pays sweep) grades a 12-6 AND
  a sweepy curve fairly under one formula. **Sub-flags are labels, NEVER formulas** — slutter, gravity-ball, AND sweeping-
  curveball are display sub-flags with no equation. Test: if a sub-flag ever needs its own equation, that's the signal it
  should have been a bucket (YES for slider-vs-sweeper, NO for the two curves).
- **Slutter grades with the SLIDER equation** (not cutter). Grading it on cutter norms breaks per-bucket recentering
  (measures a slider-labeled pitch against a population it isn't in, pollutes both). The slider eq already serves ride —
  its `−0.10·z(ivb)` is the smallest depth penalty in the breaking family. If slutters grade low post-re-derivation, fix
  the slider equation, never cross-bucket grade. "One room, one equation, graded against your roommates."
- **VAA = seam TIEBREAKER only.** Replaces release-height as the **SI/FF middle-strip** tiebreaker (flat VAA → 4S, steep →
  SI); **secondary vote** at the gyro/slider seam after cluster mean. Inherits the venue-variance flag; **NO VAA in any
  equation** until approach angle is properly derived + validated, then it replaces the `zAbs(relH/relS)` terms.

**Z-MECHANICS (confirmed in code before wiring):** z params are **per (pitch_type × hand)** — baseline
`pitcher_stuff_plus_ncaa` has pitch_type+hand+per-metric _sd, keyed `pitch_type::hand` (`:366`,`:419`). ⇒ **HB is NOT
pooled across hands** (Curveball::R hb_sd 4.07, not the ~10.6 a pooled fit would inflate to) — the HB-underweighting worry
is REFUTED; same for the gyro σ_hb (Gyro::R hb_sd 2.33). `zMax(velo)` = one-sided z vs POP mean floored at 0 (below-avg
velo = 0, not penalized). Handedness enters BOTH the per-hand baseline (primary) AND hbSign (direction). **The baseline
must RE-DERIVE on the post-reclassification populations (upstream, stamped classification_version) BEFORE the engine's
recenter-to-100 (`:450`).**

## ★ FULL FINAL EQUATIONS — v1 (Trevor 2026-08-17). REPLACE the current `stuffPlusEngine.ts` calc set VERBATIM.
9 buckets. **Master:** `Stuff+ = 100 + 20·Σ(wᵢ·zᵢ)`, all z per (pitch_type × hand) on the POST-reclassification baseline;
recenter each (type×hand) bucket to per-pitcher mean 100 after scoring. Every bucket's weights sum to exactly 1.0.

- **Four-Seam FB:** `0.30·z(velo) + 0.25·z(ivb) + 0.15·zAbs(hb) + 0.10·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.05·z(spin)` — UNCHANGED.
- **Sinker** (hbSign L−1/R+1): `0.30·z(velo) − 0.20·z(ivb) + hbSign·0.30·z(hb) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)` — UNCHANGED.
- **Cutter** (hbSign L+1/R−1): `0.30·zMax(velo) + 0.15·z(ivb) + hbSign·0.25·z(hb) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)` — **CHANGED:** `0.15·zAbs(ivb) → +0.15·z(ivb)` (signed; ride-only post-reclass, more ride strictly better).
- **Gyro Slider:** `0.30·zMax(velo) + 0.15·(−z(ivb)) + 0.25·((σ_hb−|hb|)/σ_hb) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)` — **CHANGED:** velo `0.40→0.30`; ADD `0.10·z(fb_gap)`; bullet + gravity-ball terms unchanged.
- **Slider** (hbSign L+1/R−1): `0.15·zMax(velo) + 0.10·(−z(ivb)) + hbSign·0.35·z(hb) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)` — **CHANGED:** spin `0.20→0.10`; ADD `0.10·z(fb_gap)`. (This eq also grades the "slutter" sub-flag — no cross-bucket grading.)
- **Sweeper** (hbSign L+1/R−1): `0.10·zMax(velo) − 0.10·z(ivb) + hbSign·0.40·z(hb) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)` — **CHANGED:** spin `0.20→0.10`; ADD `0.10·z(fb_gap)`.
- **Curveball** (hbSign L+1/R−1) — ONE bucket, both shapes: `0.10·zMax(velo) − 0.30·z(ivb) + hbSign·(+0.15)·z(hb) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.15·z(spin)` — **CHANGED:** HB sign `−0.15 → +0.15` (**the bug fix**); spin `0.25→0.15`; ADD `0.10·z(fb_gap)`.
- **Changeup** (hbSign L−1/R+1): `0.15·z(fb_ch_velo_diff) − 0.20·z(ivb) + hbSign·0.35·z(hb) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·zAbs(spin)` — UNCHANGED (zAbs(spin) intentional).
- **Splitter** (hbSign L−1/R+1): `0.10·zMax(velo) − 0.20·z(ivb) + hbSign·0.25·z(hb) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.25·(−z(spin))` — UNCHANGED.

**Definitions carried:**
- **`z(fb_gap)` = z of (primary FB velo − pitch velo) against the bucket-OPTIMAL gap distribution — NOT one-sided/maximal.**
  An outsized gap is a CLASSIFICATION question, not a bonus (unlike `zMax(velo)`). New feature on gyro / slider / sweeper /
  curveball. (Distinct from `fb_ch_velo_diff` in the changeup, which is its own stored column.)
- `zMax(velo)` = one-sided population z floored at 0 (below-avg velo → 0), as implemented.
- primary-fastball ID comes from the classifier (hardest FB cluster).
- Weight sums hover ~1.0 (here exactly 1.0); exact normalization is absorbed by the recenter-to-100 step, as today.
**Net change list:** curveball HB sign fix (+0.15) · cutter ivb signed · fb_gap added to the 4 breaking buckets (velo/spin
weight shaved to make room) · everything else identical. 4S/Sinker/Changeup/Splitter untouched.

## Deferred to a later "big Stuff+ conversation" (NOT this edit)
Velo/spin conventions; OPR batted-ball context-adjustment (ties to park factor); OSU-faced-**schedule** (conference
quality = teams actually faced, not overall avg) — same insight as a possible **Stuff+-faced-per-hitter** metric; the
weighting-fork philosophy.

## Key files / data
- Engine: `src/savant/lib/stuffPlusEngine.ts` (per-pitch calcs :123-296, dispatch :298, recenter :450).
- Reclass pattern to extend: `src/savant/lib/breakingBallReclassification.ts` (+ `ReclassificationRunner.tsx`).
- Conf roll-up: `src/savant/lib/conferenceStuffPlusV2.ts`, `rollupStuffPlusToMaster.ts`.
- Inputs: `pitcher_stuff_plus_inputs` (per pitch_type×hand: velocity/ivb/hb/rel_height/rel_side/extension/spin), D1
  baseline `pitcher_stuff_plus_ncaa`.
- Recompute: `scripts/recompute-stuff-plus.ts` / `npm run recompute-stuff:*`.
