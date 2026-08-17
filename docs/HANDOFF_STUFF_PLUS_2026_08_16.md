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

**Open (need Trevor):** (1) bucket count — agent counts 10 primary; "slutter"/gravity-ball a sub-flag or an 11th equation?
(2) slutter graded with cutter eq (IVB≥+5) vs slider eq. (3) bring **VAA** in at the sinker/4S + gyro/slider seams
(unused today; encodes ride-vs-drop) or keep strictly (gap,HB,IVB,spin)? All numeric thresholds still VALIDATE on our
venue-corrected clusters.

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
