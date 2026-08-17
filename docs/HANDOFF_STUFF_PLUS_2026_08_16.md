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

## ★ EXECUTION — build phases + status (2026-08-17)
Full-system flow diagram (pitch-log upload → Stuff+ → power ratings → projections → NIL/display, with every store +
display): **`docs/PIPELINE_pitch_log_to_projections.md`**. "Run it all + automate" = a 4-phase build in forced order:

**Phase 1 — data + classifier (IN PROGRESS).**
- ✅ **Venue movement-effect correction — DONE + validated (2026-08-17).** Named **"venue movement effects," NOT sensor
  errors** — we neutralize the venue's effect on IVB/HB for portable talent whether the cause is a miscalibrated unit or
  thin-air Magnus loss (altitude); Stuff+ + classification are portable talent measures, so removing it is correct either
  way. **Method (locked doctrine):** (1) **LOO** — per-venue IVB/HB residual off each pitcher's OWN season mean *excluding
  that venue* (visiting-pitcher logic; only pitchers who also threw elsewhere inform a park). LOO validated the predicted
  home-heavy understatement — worst park's IVB grew −2.57→−3.00 pre-shrink. (2) **Empirical-Bayes shrinkage toward zero**,
  pitcher as the sampling unit (`B_v=τ²/(τ²+s²_v)`, `s²_v`=pitcher-residual var ÷ #pitchers) — conservative by design
  (under-correct noise > over-correct signal). Measured **τ≈0.63″ IVB / 0.66″ HB** = true between-park spread net of
  noise; most of the raw ≥1.5″ tail was small-sample noise (the original 9 mostly collapsed; e.g. 6-arm park 3.69→0.95).
  (3) **NO THRESHOLD — apply the full 310-venue shrunk layer to every pitch;** a clean park's correction is ≈0 by
  construction, so shrinkage IS the continuous trust weight (supersedes the 8-vs-9 question — thresholds on unshrunk
  estimates catch noise and miss signal simultaneously; here 22 well-sampled parks sat *below* the raw 1.5″ line at a
  confident 1.0–1.6″). **Corrected movement = raw − venue offset, ONE layer feeding classification AND scoring both**
  (classification-only would be incoherent — bucket a pitch on its true 14 IVB, grade it on the measured 11.4 — and would
  contaminate the population means the z's center on; the population stamp exists to prevent exactly this seam).
  - **Validation pins (all cleared):** (1) **centering golden** — pitch-weighted mean applied correction −0.006″ IVB /
    +0.020″ HB (≈0, no common drift). (2) **home/road collapse** on the two worst parks' home staffs (81/79 arms, the exact
    pitchers the fix protects) — IVB split −3.73→−1.27 (66%) and +2.92→+0.81 (72%); residual = deliberate conservative
    shrinkage + the split being a broader quantity than the isolated offset. (3) **flip count (stake)** — **~7.0% of all
    pitches cross a named movement boundary** (SI/FF 3.65%, SW 2.10%, CT/SL 1.50%); per-park flip% scales monotonically
    with correction size (worst park 28% = biggest correction, no over-correction outlier); UPPER bounds (movement-only
    provisional cuts; final flip count re-runs post-boundary with velo-gap + arsenal).
  - **Provenance (locked):** raw stored alongside; corrected = a stamped VIEW with `venue_correction_version`; **per-season
    fixture** (sensor drift isn't stable across seasons — units get recalibrated/moved), re-derived fresh each season with
    the check re-run as a **standing early-season diagnostic**, not a one-time cleanup. **Eventually the framing park-effect
    machinery and this movement-offset machinery are the same tool on two sensor outputs → shared code path when convenient
    (not urgent).** [[project_park_factor_rework]] Fixture computed via `supabase db query --db-url` (staging read path);
    correction table saved `scratchpad/_venue_corrections.json`.
- ▶ NEXT: pull distributions (corrected) → per-pitcher clustering → set boundaries FROM OUR CLUSTERS → build the fastball
  classifier + revised breaking-ball thresholds (extend `breakingBallReclassification.ts`) → validate on the named-arms
  panel. **All clustering + boundaries run on the CORRECTED layer.**

**Phase 2 — equations + baseline.** Wire the 9 FINAL EQUATIONS verbatim (see "FULL FINAL EQUATIONS"); **re-derive the
baseline `pitcher_stuff_plus_ncaa` on the NEW taxonomy, stamp `classification_version`, BEFORE the recenter-to-100.**

**Phase 3 — run + store.** Score per-pitch (`pitch_log.stuff_plus`) + aggregate (`pitcher_stuff_plus_inputs`) + recenter
→ store **Conference Stuff+ (V2 canonical, retire V1)** + **per-player Stuff+ (Pitching Master)**. Acceptance gates first.

**Phase 4 — automate (Track B).** Wrap stages 2→6 of the pipeline into ONE function firing on pitch-log ingest, retiring
the scattered scripts. Then → the recompute chain (Step 6b onward), which carries the NIL `total_hitter_war` + need wiring.

**Write discipline:** stages that WRITE to staging (baseline re-derive, scoring, storage) are handed to Trevor as
`npm run …` commands / paste-SQL, not fired blind. Read/aggregation steps (venue check, distributions) the agent runs.

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
- **VAA/HAA — RESERVED, NOT DERIVED (RULING 2026-08-17).** Verified: **per-pitch VAA is NOT in any current pitch-log export**
  (checked 93-col + 112-col DRS; approach-angle absent; only a per-(pitcher×type) AGGREGATE VAA exists in
  `pitcher_stuff_plus_inputs` from the Stuff+ export — old-taxonomy, can't tiebreak the new SI/FF split). **DO NOT derive an
  approximate VAA:** the honest version needs the tracked velocity/accel components (vy0/vz0/az) we don't have; an
  approximation (release pt + extension + plate loc + gravity) yields a number that LOOKS like VAA but isn't the
  tracked-trajectory quantity, and when real VAA lands later you'd have two quantities under one name across a seam — the
  exact silent inconsistency provenance exists to prevent. A derived-approximate VAA teaching the classifier things real VAA
  later contradicts is WORSE than no VAA. **So: cluster-mean labeling carries the SI/FF middle strip now** (already works —
  costs a marginal crispness on a narrow band, not a capability). **VAA slot RESERVED:** future **local-TrackMan access
  (planned source of truth, not yet)** ships real VAA/HAA per pitch → it drops in as the strip tiebreaker as a **recorded
  decision, no redesign**, with two standing conditions: (a) it computes off the **venue-corrected** movement layer; (b) its
  arrival also **unlocks the equation upgrade** — VAA/HAA replace the `zAbs(relH/relS)` release terms. Ingest slot already
  reserved (`pitch_log.vaa` column + `VertApprAngle→vaa` mapping in `ingest_pitch_log.ts`, forward-compatible; header name
  may need updating to the real local-source format). **NO VAA in any equation or boundary until the real fields arrive.**

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
