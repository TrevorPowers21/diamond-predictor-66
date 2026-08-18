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
- ✅ **Clustering + classifier (DONE, staging, 2026-08-17).** 15,016 per-(pitcher×hand×tag) centroids on the corrected
  layer → **textbook-clean separation; the physics-designed partition confirmed by the clusters.** **armHB convention
  verified** (sinkers run more arm-side than 4S within each hand = the handedness audit passing): `armHB = RHP hb / LHP −hb`.
  **Boundaries SIGNED:** FA/SI `IVB−|armHB| ±4` (strip resolves by pitcher's own fastball-cluster mean), Cutter `IVB≥+5 &
  gap∈[2,7]` (**+5 floor HELD — do NOT loosen**), Sweeper `armHB≤−12`, Curve `IVB≤−8`, Gyro `|armHB|<5 & IVB∈[−4,4]`,
  Split `spin<~1400`. **CT/SL gap valley = 7** (measured; band 6–8 = arsenal tiebreaker). **First-cut in-DB classifier v2
  run on 2.0M pitches (20s, server-side):**
  - **~20% of tagged 4-seams are sinkers** (FA→79% 4S / 19% SI); **850 arms now carry both a 4S and a distinct SI.**
  - **Slider splits 44/22/21 → SL/gyro/sweeper**; **339 two-breaker arms (gyro+sweeper both ≥20p)**, **2,675 multi-breaker
    arms** — the two-breaker capability (Gibler-class) is live, which is why per-pitch classify → per-(pitcher×bucket)
    cluster was required over tag-centroid relabel.
  - Final mix: 4S 37 / SI 16.5 / SL 14 / CH 9 / GY 6.4 / CB 5.7 / SW 5.6 / **FC 3.6** / SPL 2.3% — realistic D1.
  - **FC = 3.6% is CORRECT (ruling): the "cutter" tag is a human catch-all** ("hard thing that cuts") the partition
    unmixes; 30%→SL are ivb<5 hard breakers correctly re-homed, 13%→4S are gap<2 cut-ride fastballs (the |IVB| reward case).
    MLB true-cutter ~6–7% with more pitch design; college 3.6% at the cluster valley is right. **Only a known-cutter panel
    arm coming back wrong moves the +5 floor — not a share preference.** **CU is also a garbage-default tag** (auto/user
    dumps any breaker into "curveball") → its 43% reclass to SL/SW/GY is correct, same lesson as FA→SI.
- ▶ **BEFORE LOCK — remaining mechanical (panel-gated):**
  1. **Distance-bounded small-spillover folding (RULING):** fold a pitcher's stray sub-threshold cluster into its nearest
     real cluster ONLY IF within a sane distance; **anything small AND far from every real cluster → classification
     EXCEPTIONS LOG, never folded** (a pitcher experimenting with a nascent pitch for 15 throws is real — folding his new
     splitter into his changeup erases what the exceptions log exists to keep). Distance-bounded folding, far-outliers
     logged, per the no-silent-forcing rule.
  2. **CT/SL arsenal tiebreaker** in the 6–8 gap band (2nd breaking ball → cutter, else slider).
- ▶ **THE GATE — named-arms panel (Trevor supplies, outstanding):** ~20 arms he knows cold, Gibler first, covering seams
  deliberately (a two-breaker arm or two, a known true cutter, a sinker-primary guy, a splitter arm, a sweeper guy, + a
  couple he'd bet the classifier gets wrong). Run classifier pitch-by-pitch against them BEFORE lock. **That list is the
  exam — the last gate between here and the new Stuff+ going live.** Then: fold equations (hbSign retired) → re-derive
  baseline per (type×hand) on this taxonomy (stamp classification_version) → 9 equations load → recenter → pre-registered checks.

- ⛔ **THE GATE CAUGHT A REAL GAP (2026-08-17) — human panel WAIVED (Trevor can't rattle 20 arms cold), replaced by a
  4-check ground-truth lock gate.** Checks: (1) **TrackMan stability benchmark [MANDATORY primary]** — same 3,629 arms /
  half-split, TM raw tags vs ours, by family; **pre-registered prediction: we beat TM overall + gap concentrates in
  BREAKING; STOP if TM ties/beats us anywhere.** (2) **Archetype-pure auto-panel** — ~15-20 DB-queried center-of-mass arms
  (dead-center in a bucket, far from seams), assert bucket match, expect 100% (any miss = hard bug). (3) **Absurdity
  goldens** (permanent): no 0HB/0IVB→CB, no −IVB→4S, no <1400spin→CH, no gap0→CB, no |armHB|≥12→GY. (4) **Low-confidence
  video check** — 10 lowest-confidence exceptions-log cases (Gibler incl.), Trevor eyeballs ~30min. Consistency (stability/
  coherence/mix) ≠ correctness — a misplaced boundary passes all consistency checks; the comparative gate is the
  ground-truth catch.
  **★ CHECK 1 CAUGHT THE SHORTCUT (as designed):** the implementation had quietly diverged from the LOCKED cluster-then-label
  architecture to **per-pitch boundary labeling** — a failure mode the 4 consistency checks were structurally blind to.
  **Failed prediction ON RECORD as written:** predicted we beat TM in breaking; the per-pitch shortcut LOST breaking
  (0.816 vs 0.858 mix; 75.9% vs 87.2% arsenal-top) + offspeed (0.929 vs 0.960); won overall (0.834 vs 0.822) + FB (0.911 vs
  0.877, sinker extraction working). **This is NOT evidence about the taxonomy — only about the shortcut; the comparison was
  never fair to run pre-clustering** (per-pitch flips seam-straddlers; our 4 breaking buckets carry 3 internal seams to TM's
  coarse-and-trivially-stable 1). 2nd time pre-registered discipline caught a finish-line gap (SS −1,141 = 1st). **Risk
  asymmetry (Trevor):** a non-reproducing arm = THAT ARM ambiguous (→ one cluster, one label, low-confidence, exceptions log),
  NOT a league-wide indictment; the resolution-vs-stability tradeoff only becomes real if the POPULATION still loses at
  cluster level. **REBUILD = full locked design (NOT a patch):** per-pitcher clustering on the corrected layer → clusters
  labeled by their MEANS vs the boundaries → all seams resolved by the pitcher's own cluster structure → arsenal tiebreakers
  at CT/SL + gyro/curve → distance-bounded folding (far-outliers → exceptions log) → sub-150-pitch arms on global fallback
  applied to cluster means. **Re-run Check 1 against the UNMODIFIED prediction** (no moving the target). Pass → Checks 2–4 +
  lock. Still loses breaking at cluster level → bring the per-arm reproducibility distribution; Trevor makes the
  resolution-vs-stability call ("we distinguish gyros from sliders" is a selling point up to the moment it costs believability).
- ✅ **REBUILT to the locked design + GATE CHECKS 1–3 PASS (2026-08-17).** **Deployed classifier = full-season per-pitcher
  clustering:** boundary-seed each pitch → agglomeratively MERGE a pitcher's seed-clusters that are one pitch split by a seam
  (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) → label each merged cluster by its MEAN vs the boundaries → apply that label to all the
  cluster's pitches (straddler collapses to one stable label; genuine two-breaker stays split). **Check 1 (re-run vs the
  UNMODIFIED prediction): OURS WINS ALL FOUR** — overall 0.860 vs 0.822 (+0.038), FB 0.938 vs 0.877 (**+0.062**), BREAKING
  0.870 vs 0.858 (+0.012), OFF 0.982 vs 0.960. Breaking swung **+0.15** from the shortcut — diagnosis confirmed, taxonomy
  vindicated. **Honest deviation from the prediction's SHAPE clause:** the gap does NOT concentrate in breaking — our biggest
  edge is **FB (+0.062, the sinker extraction)**; breaking is a narrow win (TrackMan's breaking tags steadier than the thesis
  assumed). Our real advantage over TrackMan is pulling sinkers out of the 4-seam bin, not de-scattering breakers. **Check 2**
  (nine center-of-mass archetypes → correct bucket): PASS. **Check 3** (absurdity goldens): PASS after a fix the golden forced
  — **the CB rule `IVB≤−8 → curve (any gap)` was stealing ARM-SIDE deep pitches** (hard sinkers/screwballs, +11..+18 armHB)
  **and fastball-velo depth**; fixed to **CB requires `IVB≤−8 AND armHB<4 (glove/neutral) AND gap≥4`**; arm-side-deep →
  offspeed; **fastball-velo depth (`IVB≤−8 & gap<4`) → REVIEW/exceptions** (24 clusters, physically inconsistent = mis-identified
  primary FB or freak; never force-labeled). **Check 4 (the one human step) OUTSTANDING:** 10 lowest-confidence seam-dweller
  clusters + the REVIEW anomalies (Gibler incl.) → Trevor eyeballs on video ~30 min. Then lock → fold equations → re-derive
  baseline (classification_version) → recenter → numeric checks. Merge thresholds + REVIEW rule = params in the deployed classifier.
- ★ **ANCHOR-BASED ARSENAL CONSTRUCTION (Trevor 2026-08-17) — REPLACES the univariate Δ-merge rule; a real architecture
  principle.** The pitcher's arsenal is built from his **ANCHOR pitches** (high-usage, unambiguously-distinct clusters);
  everything marginal **gravitates to its nearest anchor** instead of standing alone ("gravity toward the main pitch").
  **Mechanics:** (1) cluster the arm's pitches → identify **ANCHORS** = clusters with real usage (**≥60 pitches OR ≥10% of
  his mix**) that sit **clearly separated in full movement space** (close candidate anchors merge into one). Anchors = his
  repertoire. (2) any **residual** cluster — low-usage OR within close **MULTIVARIATE proximity** of an anchor — **folds into
  the nearest anchor and inherits its label** (no independent identity). (3) **FAR-OUTLIER protection survives:** a small
  cluster genuinely distant from every anchor does NOT fold → **exceptions log** (the kid experimenting with a real new pitch
  still gets seen). (4) **GUARD so it doesn't over-eat:** proximity folding requires the candidate be **plausibly the same
  pitch FAMILY** as the anchor — **near in VELO/GAP especially** (velo-gap similarity guard). Same speed off the same fastball
  + near-identical sweep = **one pitch varying its finish**; same movement + different speed = **two pitches by definition**.
  So an 80-pitch changeup never folds into a slider just because they sit close in raw movement. (5) **DISPLAY comes free:**
  the anchor is what shows (his breaking ball / his fastball, usage-ranked); **folded pitches count into the anchor's totals**
  so mix% reflects the merged reality. **Replaces** the univariate Δ3.5-IVB merge (dies) with multivariate proximity-to-anchor;
  **generalizes** the distance-bounded folding (now covers the 97-pitch case too — proximity does the work, not just size).
  **New absurdity golden:** no near-0-armHB cluster labels slider (a bullet is a gyro, not a slider). **Gibler acceptance
  case:** expected output **one 4S, one gyro (~387 pitches, gravity-ball flag), one CH** — his 290-pitch gyro is the anchor,
  the 97-pitch depth cluster sits within a whisker in every dimension except tilt → folds in, one gyro with a gravity-ball
  sub-flag. **Stability should IMPROVE by construction** — a depth-varying breaker's half-season splits land in the SAME
  anchor both halves instead of splitting on the tilt axis. **This is the merge-rule replacement to implement.**
- ✅ **EXCEPTIONS = SCORE-AND-FLAG (RULING, Trevor 2026-08-17) + IMPLEMENTED/VALIDATED.** The distant low-usage clusters that
  don't fold **keep their own centroid label (nearest bucket, so they ARE scored) + a confidence/exceptions FLAG** (queryable
  for review; recurring far-clusters → next season's rule refinements). **Holding them unlabeled is the ONE option that both
  loses information AND hides the loss** — violates "nothing silently dropped" (mix% would lie, per-type Stuff+ sample shrinks,
  run-value ledger loses events). **NEW MONITORED GOLDEN:** **flagged-cluster share** — baseline **6.86% of pitches**; assert
  it stays ~there, **alert if it drifts UP across a season** (= anchor rules degrading; the number says so before the product
  does). **FINAL deployed Check 1 (anchor + score-and-flag, flagged clusters INCLUDED — the honest shipping number):
  WINS ALL FOUR** — overall 0.867 v 0.822 (+0.046), FB 0.948 v 0.877 (**+0.072**), BREAKING 0.884 v 0.858 (**+0.026**), OFF
  0.977 v 0.960 (+0.017). (Including the flagged low-usage clusters pulls breaking from the +0.084 exclude-number to +0.026 —
  they're inherently less stable half-to-half; still wins everywhere. Thesis holds; biggest edge stays FB/sinker-extraction.)
  Gravity-flag cosmetic fix (fire on gyro anchors only) = queued, classification-neutral. **PIPELINE IS DONE/AUTOMATIC PAST
  THIS POINT — waiting ONLY on Trevor's Gibler video** (one breaking ball → fold validated on its origin story; two → tighten
  proximity). Then lock → fold equations → re-derive baseline (classification_version) → recenter → numeric checks → recompute chain.

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

## ★★ FOLDED FINAL EQUATIONS (armHB, hbSign RETIRED) — 2026-08-17. THIS is what wires into `stuffPlusEngine.ts` (supersedes the hbSign forms above).
**The fold (confirmed + classifier LOCKED):** `armHB` = arm-side-positive (RHP hb / LHP −hb) is THE horizontal column everywhere.
`hbSign` disappears; each bucket's HB term becomes a **fixed per-bucket sign on `z(armHB)`** — **`+` for arm-side buckets
(SI/CH/SPL), `−` for glove-side buckets (FC/SL/SW/CB)**. That sign is a BUCKET property (arm-side vs glove-side virtue), not a
hand property — no per-hand logic survives. `zAbs`/`|·|` terms already hand-agnostic → unchanged (hb→armHB). IVB does not fold.
Baselines re-derive per (type×hand) on `armHB`. Master: `Stuff+ = 100 + 20·Σ(wᵢ·zᵢ)`, recenter each (type×hand) bucket to 100.
- **Four-Seam:** `0.30·z(velo) + 0.25·z(ivb) + 0.15·zAbs(armHB) + 0.10·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.05·z(spin)` — unchanged (|armHB|).
- **Sinker** (arm-side +): `0.30·z(velo) − 0.20·z(ivb) + 0.30·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)`
- **Cutter** (glove-side −): `0.30·zMax(velo) + 0.15·z(ivb) − 0.25·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)`
- **Gyro Slider:** `0.30·zMax(velo) − 0.15·z(ivb) + 0.25·((σ_armHB−|armHB|)/σ_armHB) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext)` — bullet term |armHB|, hand-agnostic.
- **Slider** (glove-side −): `0.15·zMax(velo) − 0.10·z(ivb) − 0.35·z(armHB) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)`
- **Sweeper** (glove-side −): `0.10·zMax(velo) − 0.10·z(ivb) − 0.40·z(armHB) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·z(spin)`
- **Curveball** (glove-side −): `0.10·zMax(velo) − 0.30·z(ivb) − 0.15·z(armHB) + 0.10·z(fb_gap) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.15·z(spin)` — the `−0.15·z(armHB)` IS the sign-bug fix, now folded (glove-side sweep rewarded).
- **Changeup** (arm-side +): `0.15·z(fb_ch_velo_diff) − 0.20·z(ivb) + 0.35·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) + 0.10·zAbs(spin)`
- **Splitter** (arm-side +): `0.10·zMax(velo) − 0.20·z(ivb) + 0.25·z(armHB) + 0.05·zAbs(relH) + 0.05·zAbs(relS) + 0.10·z(ext) − 0.25·z(spin)`
**Equivalence check:** folded `±coeff·z(armHB)` reproduces the old `hbSign·coeff·z(hb)` exactly (sd invariant under negation), for both hands, with NO scattered sign logic. "More break the good way" is identical for L and R by construction.

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

## ★★★ PHASE 2 COMPLETE (D1) + WHAT'S NEXT — 2026-08-17
**Stuff+ REBUILD DONE + VALIDATED on staging** (full detail: `docs/STUFF_PLUS_RESUME_2026_08_17.md`; learnings:
`AGENT_LEARNINGS_stuff_plus` §Phase 2). Chain: anchor classifier → folded scoring (corrected layer, armHB, gap) →
2.0M `pitch_log.stuff_plus` (means ~100, SD 9–17, velo corr +0.54) → per-player `Pitching Master.stuff_plus` (4,794) →
`Conference Stats."Stuff_plus"` V2 (30 D1 confs; SEC/ACC/BigTen top = sane). All reversible (backups saved).

### THE WHAT'S-NEXT PLAN
**A. RECOMPUTE CHAIN — the real next step (Stuff+ now moves the product numbers).** The transfer/projection engine consumes
   conf Stuff+ (hitter opposing-quality lever) + per-player Stuff+ (→ HTP, pitcher opposing-quality). With new values live:
   - **Step 6b:** deploy the transfer edge fn (canonical, no-PVF etc. per `project_transfer_engine_audit`) + fire the
     transfer recompute (+ returners if stale) → projections re-land on new Stuff+ + all WAR-redesign changes, ONCE.
   - **Step 7b/7c/7d:** fill `player_snapshot`/`transfer_snapshot` WITHOUT touching toggles + refresh displayed metrics.
     ⚑ This ALSO resolves [[project_teambuilder_owar_snapshot_regression]] — filled snapshots → TB reads snapshot, not the
     divergent live-rebuild. (Verify Souza/Traeger after.)
   - Carries the NIL wiring: score→`total_hitter_war` + need-premium (gated on 6b/7c per `HANDOFF_NIL_2026_08_16.md`).
   - A/B both sides + verify before anything ships.
**B. PIPELINE CONSISTENCY (housekeeping, non-blocking).** Re-aggregate `pitcher_stuff_plus_inputs` D1 rows on the new
   taxonomy (derivers/savant read it); retire the V1 name-keyed conf-Stuff+ script; then fold the WHOLE Stuff+ recompute
   into the ONE on-ingest function (Track B — [[project_unified_projection_edge_function]]).
**C. DEFERRED MODELING.** JUCO Stuff+ recompute (unfreeze when ready — apply the new D1 baseline + folded eqs to JUCO data);
   **park factors re-eval** (quick, right after Stuff+ — [[project_park_factor_rework]]); the "big Stuff+ conversation"
   (velo/spin conventions, OPR context-adjust, OSU-faced-schedule / Stuff+-faced-per-hitter, weighting fork).
**D. CLEANUP.** Drop backups + helper tables after acceptance (`_ncaa_backup_preanchor`, `_master_stuff_backup`,
   `_confstats_backup`, `_reclass_result/_map/_pf`); **clear Savant** (dead) → Season Stats display is the live surface.
**E. PROD.** Stuff+ rebuild staging→prod = REGENERATE on PROD data end-to-end (venue corrections → reclassification →
   baseline → recompute → rollups), NOT copy staging. Append every migration to `PROD_MIGRATIONS_TODO.md`. Per-season fixture.

## ★★★ PRE-EDGE-FN PLAN + TREVOR'S DECISIONS (2026-08-18) — finalize EVERY lever before firing 6b
Stuff+ is done, but the edge fn (6b) must NOT fire until every OTHER projection lever is final too (don't-change-twice).
Trevor's decisions below are the plan. **Overarching principle: everything STORED + consistent in the DB — NO live computes
on a single page that aren't in the transfer snapshot; ONE edge function start-to-finish (Track B) that computes conference
stats → HTP/park → projections → snapshots, all stored.**

### A. PVF — DROP IT (Trevor)
Strip the weekend-SP `1.2×` market premium from the edge fn (`index.ts:672`) to match canonical (`depthRoles.ts:264`, which
dropped it: a starter's role value is already in WAR via IP, so a PVF premium double-counts). Any starter/position premium
"will only most likely live in the TEAM BUILDER setting" — to discuss separately, and it ties into position-of-need (below).

### B. POSITION OF NEED — must be STORED, not a live compute (Trevor: "I hate any live computes on one singular page that
isn't stored in the transfer snapshot and consistent in the database")
Open DESIGN (decide before it drives values): the p70 championship-starter need premium ([[project_player_score_nil_allocation]],
positionNeed helpers) must be STORED in the transfer snapshot, not computed live on one page. Two options:
- **(Trevor leaning) Coach declares "positions of need" pre-offseason via a POPUP** → stored → increases per-player values
  when p70 is NOT a starter *at that declared position* (targeted, program-specific need premium).
- **Across-the-board** need ladder (uniform, no coach input).
Either way: STORE it (snapshot), consistent DB-wide. Do NOT wire the need premium until this is settled + stored.

### C. HTP — STORE IT (agreed)
Compute HTP once and store per conference×season in the stored conference table (kills the 3-copies live-recompute drift;
matches stored-derived-values). Update the readers (canonical/edge/TB) to read stored HTP.

### D. CONFERENCE STATS — finalize/check + stabilize + fold into the edge fn (Trevor)
Trevor waited until the regular season ended before running another projection, so values SHOULD be accurate — but CHECK
them, and **stabilize HOW they're computed and include that in the MAIN edge function start-to-finish** (conf-stats
computation becomes part of the one pipeline, not a side script). Keep the **conf-vs-conf vs overall-across-conference**
distinction clean: wRC+ + raw conf factors are conference-SPECIFIC (separate table — `conference_adjusted_stats`); OPR/HTP/
Stuff+ are overall-across-conference (`Conference Stats`).

### E. PARK FACTOR — TWO DISTINCT USES (Trevor's key correction)
1. **HTP run-environment term:** conference-average RUN factor (`runs_factor`/`overall_factor`), normalized to 100, REPLACING
   `0.75·(100−wRC+)`. (Run friendliness is exactly what the wRC+ term stood in for.)
2. **Per-metric PROJECTION park adjustment:** project each HITTING metric (AVG, OBP, ISO/SLG) source-park→dest-park using
   **PER-METRIC** park factors — NOT a run factor ("we are projecting batting average from one park to another, not runs").
   PITCHING (ERA/FIP) uses the RUN factor. These per-metric factors ALREADY EXIST and resolve via `resolveMetricParkFactor`
   (`src/lib/parkFactors.ts`; metrics avg/obp/iso/era/whip/hr9) — "all of that is in there." Confirm the source-column mapping
   in `fetchParkFactors` when wiring (table has overall/runs/hits/hr/doubles/bb_factor → avg/obp/iso/era derived there).
- **DATA SOURCE = the existing MANUAL 3-YEAR ROLLING park factors** (Trevor's manual calc combining pitching + offense) —
  STABLE (parks need multi-year to settle). Use these NOW.
- **Pitch-log venue-specific park factors** (per-player + per-venue, from the pitch-log venues) = FUTURE upgrade — the pitch
  log gives venue-specific but only 2026; 1 year is too noisy for parks, and we lack 2024/25 without imports. **Gated on
  importing prior-year pitch logs (multi-year); deferred + to discuss.** [[project_park_factor_rework]]

### PRE-EDGE-FN PUNCH LIST (order)
1. **PVF:** strip weekend-SP premium from edge fn (align canonical).
2. **HTP:** swap `(100−wRC+)` → conf-avg RUN factor; STORE HTP per conf×season; readers read stored.
3. **Conference stats:** check/finalize + stabilize computation + fold into the edge fn start-to-finish; conf-vs-conf vs overall clean.
4. **Park factor:** per-metric (existing 3-yr manual) for projection; run factor for HTP + ERA/FIP. Confirm fetchParkFactors mapping.
5. **Position-of-need:** decide (coach-popup-stored vs across-board) + STORE in snapshot — before it drives values.
6. **Transfer engine:** sync the 3 copies to canonical (edge-fn PVF removal is part of this; triple-oWAR delete) — [[project_transfer_engine_audit]].
7. **Verify OPR / wRC+ currency.**
→ THEN edge fn (6b) → snapshots (7c, also fixes the TB oWAR regression) → NIL wiring. All inputs final, projections land ONCE.

## ★ REFINEMENTS after reading the code (Trevor 2026-08-18) — SUPERSEDES the "run factor for HTP + ERA" phrasing above
**Verified in code — HTP and ERA are NOT the same bucket:**
- HITTING projection (`src/lib/buildTransferProjectionInputs.ts:203-208`): per-metric per-team park factors **avg/obp/iso**
  (+ handedness splits). EXISTS today, unchanged.
- PITCHING projection (`buildTransferPitcherInputs.ts:232-237` → `transferPitcherProjection.ts:134` `parkTerm`): per-metric
  per-team park factors **era/whip/hr9**. EXISTS today, unchanged — **ERA uses its OWN individual `era` park factor, NOT a
  run factor, NOT the conference aggregate.** (Trevor: don't bucket HTP + ERA without reading what each uses.)
- **THE ONLY NEW PARK CHANGE = HTP's run-env term.** Replace `0.75·(100−WRC+)` with a **conference RUN-ENVIRONMENT metric**
  (conf-average of member teams' run/overall park factor), **STORED in `Conference Stats`**, feeding HTP. Trevor: "a major
  win and necessity." The per-metric projection factors (avg/obp/iso, era/whip/hr9) are UNTOUCHED, off the existing 3-yr manual.

**POSITION-OF-NEED — RESOLVED (Trevor 2026-08-18):** AUTO-compute from the roster (where p70 isn't a starter at a position),
but **STORE it as a per-player toggle in the DB that re-checks + REACTS as roster changes are made** — NOT a live one-page
compute. PLUS a definite future **per-year "positions of need" QUESTIONNAIRE** (coach-declared) for offseason planning,
layered on top. So: automatic + stored + roster-reactive now; coach questionnaire later.

**★ FUTURE VISION (perfect world, like Stuff+): per-PA / per-outing park factor + per-PA/outing Stuff+/HTP FACED.** For each
player, the EXACT quality of hitters/pitchers he faced + the EXACT parks he hit/pitched in, per at-bat/pitch — not conference
averages. The granular truth of competition + environment (ties to OSU-faced-SCHEDULE + per-player park factor). Deferred,
gated on per-event pitch-log data + multi-year imports. [[project_park_factor_rework]]
## ★ CORRECTION (Trevor 2026-08-18) — the "era" factor IS a run factor + handedness is critical
- **The `era` park factor is actually a per-team RUNS-PER-GAME factor.** Trevor labeled it "era" only because it was designed
  to feed ERA projection — it is NOT an ERA-specific quantity, it's runs/game. So DISREGARD the earlier "ERA is not a run
  factor": pitching park adjustment IS run-based, just at **per-team (individual) granularity**. ⇒ **The conference
  RUN-ENVIRONMENT metric for HTP = the conference-AVERAGE of these per-team runs/game ("era") park factors** — the SAME
  underlying quantity as the pitching park factor, aggregated to the conference. (Verify the exact column feeding "era" in
  `fetchParkFactors` — it maps to a runs/game park effect, likely `runs_factor`/`overall_factor`.)
- **★ HANDEDNESS is VERY important on the HITTER side.** The per-metric hitting park factors (avg/obp/iso) MUST use the
  **lhb/rhb handedness splits** (`resolveParkFactor(..., playerHand)` → lhb_/rhb_ columns) — a LHB and RHB see different park
  effects. Require + preserve handedness in the hitting park projection; do NOT collapse to combined factors on the hitter side.
## ★ REFINEMENTS (Trevor 2026-08-18, cont.) — handedness / park-into-edge-fn / position-of-need design
- **HANDEDNESS (correction to "never combined"):** use the lhb/rhb SPLIT for one-handed (L/R) hitters; use COMBINED for
  SWITCH hitters (they see both sides) and for PITCHERS (some already use combined). So: split for L/R hitters, combined for
  switch + pitchers. `resolveMetricParkFactor`/`pickFactor` already does this (hand-split if present, else combined; switch→combined).
- **PARK/HTP conf run-env is LOGGED + built INTO the start-to-finish edge function** (Track B): the conference run-environment
  metric (conf-avg of per-team runs/game "era" factor) is computed + STORED in `Conference Stats` AS PART OF the one edge-fn
  pipeline — not a separate one-off script.
- **★ POSITION-OF-NEED DESIGN (Trevor's — THE plan):** read the INDIVIDUAL BUILD (the active roster build) → compute per-player
  **`is_position_of_need` = true/false** (p70 at that position isn't a starter → need exists) → **store it right next to
  `dev_aggressiveness`** (build player meta) → **on EVERY SAVE, re-run the check + update the flag** (roster-reactive, NOT a
  live one-page compute). **Store it in the `transfer_snapshot`** (that's where roster ADDITIONS are sourced) and MAINTAIN it
  into the `player_snapshot` → BOTH the ROSTER (player_snapshot) and the TARGET BOARD (transfer_snapshot) carry a consistent
  flag. The need premium then READS the stored flag (never recomputed live). FUTURE: a per-year coach "positions of need"
  questionnaire layered on top for offseason planning.
## ★ PUNCH-LIST REFINEMENTS (Trevor 2026-08-18, after full doc re-read) — park phase-in, HTP run-env, conf-stats-as-build
These SUPERSEDE the earlier "park = manual 3-yr forever / pitch-log deferred indefinitely" framing.

1. **HTP run-env term = RUN SCORING ENVIRONMENT, NO handedness, 3-YEAR ROLLING.** HTP's replacement for `0.75·(100−wRC+)`
   is a pure run-scoring-environment factor — **no handedness split** (handedness lives ONLY on the hitter-side per-metric
   avg/obp/iso factors; HTP is a run environment, not a batted-ball metric) — as a **3-year rolling average**, stored in
   `Conference Stats` (conf-avg of member-team run factors), folded into the edge fn.

2. **★ PARK FACTOR PHASE-IN (concrete plan — replaces "deferred indefinitely"):** BUILD a pitch-log→park-metrics process
   that calculates ALL park-factor metrics from the pitch log, then phase manual→pitch-log over 3 years:
   - **End of 2026:** 2026 park metrics computed FROM the pitch log + **upload the 2 prior seasons (2024 + 2025)** → the
     three combine into the **end-of-2026 3-year-rolling park factors**.
   - **2027:** both 2026 + 2027 come from pitch logs, + the one leftover uploaded year (2025) still in the 3-yr window →
     rolling = 2025(uploaded) + 2026(PL) + 2027(PL).
   - **2028+:** 2026+2027+2028 all pitch-log-derived → **fully pitch-log-specific**, uploads fully rolled off.
   - ⇒ The park factors THEMSELVES become pitch-log-derived (not manual-forever); parks still need multi-year to settle so
     the 3-yr window holds. ⚠ OPEN: whether the "2 uploaded prior seasons" are prior-year pitch-log imports or Trevor's
     existing manual park data reshaped to the new metric set — CONFIRM before building the uploader. [[project_park_factor_rework]]

3. **CONFERENCE STATS = a NEW BUILT PROCESS (not a check of existing values):** "recognize the rules and build a pitch-log
   run to store everything in the conference stats database that is used." So conf-stats computation is BUILT FRESH as a
   pitch-log run that writes every used field into `Conference Stats`, folded into the start-to-finish edge fn. (Upgrades
   punch-list #3 from "check/finalize existing" to "build the pitch-log conf-stats run.")

4. **POSITION-OF-NEED design CONFIRMED** ("I like it") — the `is_position_of_need` toggle (read active build → per-player
   bool next to `dev_aggressiveness` → re-check on every save → stored in transfer_snapshot, maintained into player_snapshot).

5. **TRANSFER ENGINE SYNC CONFIRMED needed** — strip weekend-SP PVF from edge fn, delete triple-oWAR, sync 3 copies to canonical.

6. **★ EDGE-FN BUILDOUT INCLUDES A DEAD-CODE/DATA/FUNCTION AUDIT.** Building the ONE edge-fn run for all of this is ALSO the
   moment to "find dead code/data/functions and see what we need to keep vs remove" — the clear-then-build theme applied to
   the whole pipeline (retire scattered scripts, drop dead tables/columns, remove superseded functions AS the one process is
   assembled). Savant clear + V1 conf-Stuff+ retirement + backup/helper-table drops all fold into this audit.

### UPDATED PRE-EDGE-FN PUNCH LIST (order)
1. **PVF:** strip weekend-SP premium from edge fn (align canonical).
2. **HTP:** swap `(100−wRC+)` → conf run-env RUN factor (no handedness, 3-yr rolling); STORE per conf×season; readers read stored.
3. **Conference stats:** BUILD the pitch-log conf-stats run (recognize rules → store every used field in Conference Stats);
   keep conf-vs-conf (wRC+/raw, `conference_adjusted_stats`) vs overall (OPR/HTP/Stuff+, `Conference Stats`) clean; fold into edge fn.
4. **Park factor:** BUILD pitch-log→park-metrics process + phase-in (2026 PL + 2024/25 upload → end-2026 3-yr; →2028 full PL).
   Per-metric (avg/obp/iso w/ handedness; era/whip/hr9) for projection; run factor for HTP. Confirm `fetchParkFactors` mapping + the upload source.
5. **Position-of-need:** `is_position_of_need` toggle — stored, roster-reactive, transfer_snapshot→player_snapshot.
6. **Transfer engine:** sync 3 copies to canonical (edge-fn PVF removal + triple-oWAR delete).
7. **Dead-code/data/function audit** — keep-vs-remove as the one edge fn is assembled (Savant clear, V1 conf retire, backups drop).
8. Verify OPR / wRC+ currency.
→ THEN edge fn (6b) → snapshots (7c, also fixes TB oWAR regression) → NIL wiring. All inputs final, projections land ONCE.
## ★ SEQUENCING + UPLOAD-SOURCE DECISION (Trevor 2026-08-18)
- **PARK FACTOR before HTP** (Trevor): build + stabilize + VERIFY the park-factor process FIRST so nothing discovered
  there later changes what feeds HTP. HTP's run-env term = conf-avg of the per-team RUN park factors, so park is HTP's
  input — settle park before computing HTP off it. New order: PVF → **PARK** → **HTP** (computed off settled park, stored
  in Conference Stats) → conf-stats build (stores HTP + all used fields) → position-of-need → transfer sync → dead-code
  audit → edge fn. (HTP + conf-stats overlap: HTP computation is PART OF the conf-stats build; adjacent by design.)
- **2024/2025 park upload source = MANUALLY-CALCULATED DATA RESHAPED to the metric set** (NOT prior-year pitch-log imports).
  ⇒ TWO input paths into ONE target park-metric schema: (a) pitch-log→park-metrics compute for 2026 (the real process);
  (b) a reshape/import of Trevor's manual 2024+2025 park data into the SAME columns. Trevor will send example rows to
  define the exact target metric set/schema both paths must produce. BUILD ORDER: lock the target park-metric schema from
  his examples FIRST, then build the 2026 pitch-log compute to that schema, then the manual-reshape import to the same schema.
## ★ PARK DATA ACQUIRED + VALIDATED (2026-08-18) — single-season 2024/2025 in hand
**Trevor pulled single-season 2024 + 2025 park factors from TruMedia and archived them by year (permanent, "never do it
again").** This UNBLOCKS the real 3-yr-rolling phase-in (the prior `3YR 0518` export was pre-blended → not decomposable;
these are true single seasons).
- **Location (LOCAL RSTR IQ Data, the one with `staging/` — NOT the Google Drive pitch-log folder):**
  `/Users/danielleogonowski/RSTR IQ Data/park-factors/2024/` and `/2025/` — 6 cohort files each
  (Combined/LeftHanded/RightHanded × Hitter/Pitching), 307 teams per file.
- **Schema (header-name-keyed, order-robust):** `Rank, teamId, teamName, team, teamFullName, location, teamAbbrevName,
  teamLevel, synergyTeamId, newestTeamId, newestTeamLevel, newestTeamName, newestTeamAbbrevName, newestTeamLocation` +
  metrics `AVG, OBP, ISO, R/G`. NOTE: 2024/25 handed files ALSO carry R/G (2026 handed files didn't) — we IGNORE handed
  R/G (HTP run-env = combined-only, no handedness). Column ORDER differs from the 2026 files — harmless, importer keys by name.
- **Validated single-season** (Penn combined-hitter R/G 2024=9.22 vs 2025=7.21 — distinct years, not the blend).
- **★ SMALL-SAMPLE CAVEAT (from the data):** single-season HANDED splits are noisy at small parks — e.g. Penn 2024 LHB
  hitter = `.100/.250/.000, R/G 0.11` (≈no LHB data that year). The pre-blended 3YR smoothed this; OUR rolling build must
  handle sparse cohort cells (fall back to combined OR PA-weight the blend) — never average a near-empty cell in raw.
- **PARK PROCESS DESIGN (locked target):** per-SEASON park factors, normalized to THAT season's league baseline (per-year
  NCAA avg/obp/iso from `ncaa_averages`; R/G constant per year), stored by season; the pipeline computes the 3-yr ROLLING
  as "last 3 seasons averaged" at build time (pipeline owns the blend, data stays single-season). Cohorts: Combined (→
  pitchers + switch hitters), LHB, RHB. Factor = `((hitter_at_home + opp_at_home)/2) / season_NCAA × 100` per cohort/metric
  (same method as `import-park-factors-2026.ts`). 2026 = pitch-log-derived to this SAME schema; 2027 both PL; 2028 all PL.
- **ACCEPTANCE GATE (optional, recommended):** pull TruMedia single-season 2026 too → cross-check our pitch-log-derived
  2026 park numbers against TruMedia's own 2026 before park ever feeds HTP. (Not yet pulled.)
## ★ 2026 CROSS-CHECK SET IN + NEUTRAL-SITE TOLERANCE (pre-registered, 2026-08-18)
- **2026 single-season TruMedia park files placed** at `/Users/danielleogonowski/RSTR IQ Data/park-factors/2026/`
  (6 cohorts, ~308 teams). This is the ACCEPTANCE-GATE reference for the pitch-log-derived 2026 park compute.
- **★ PRE-REGISTERED TOLERANCE (Trevor):** the pitch-log compute will NOT match TruMedia exactly, BY DESIGN — TruMedia
  filters by HOME/AWAY, while our pitch-log compute attributes each pitch to its ACTUAL `game_venue_id`, so **NEUTRAL-SITE
  venues resolve differently** (we credit the real neutral park; TruMedia's home/away filter handles it differently/excludes).
  Expectation: CLOSE but not exact, with **neutral-site parks the expected divergence points; "shouldn't be off by a ton."**
  ⇒ Gate = agreement within a sane tolerance on non-neutral parks + explainable neutral-site deltas — NOT bit-exact equality.
  A large delta at a NORMAL home park = investigate; a delta at a known neutral site = expected. [[feedback_predictions_on_record_at_right_grain]]
## ★ PARK-FACTOR ARCHITECTURE LOCKED (Trevor 2026-08-18) — two-table, stored rolling
Trevor confirmed all six design points. Decisions:
- **"Combined per program" = YES:** each team's factor per metric per cohort = `mean(hitter_file_value, pitcher_file_value)`
  — Hitter file = team offense in its home park; Pitcher file = opponents in that same park; averaging cancels team-quality bias.
- **Per-season normalization to that season's OWN NCAA baseline** (2024 NCAA for 2024, etc.) — Trevor: "i take back what i said" (agrees each year normalizes to its own league averages, NOT a single shared baseline).
- **★ TWO-TABLE SHAPE (stored rolling, NOT rolling-on-read — rolling-on-read would violate stored-not-live):**
  - **`park_factors_seasonal` (NEW):** raw SINGLE-SEASON factors, one row per team per season (2024, 2025, 2026, …). Pipeline inputs/archive only.
  - **`Park Factors` (EXISTING, schema unchanged):** the STORED 3-yr ROLLING blend per season = avg of the last 3 single-seasons.
    Every existing reader keeps reading `Park Factors[season]` UNCHANGED — the number still means "3-yr rolling for that season"
    (same as the old `3YR` export), only now BUILT by our pipeline from stored inputs instead of a black-box TruMedia export.
  - ⇒ Rolling stays STORED, inputs reproducible, NO downstream/reader changes.
- **Sparse handed-cohort → COMBINED fallback:** any limited-sample handed cell (e.g. Penn 2024 LHB .100/.250/.000) uses the
  combined factor rather than averaging noise. "Shouldn't happen a ton; any limited sample on handedness simply uses combined."
- **NEXT (logged, wired into future steps):** the ONE edge function computes the 2026 (then 2027+) SINGLE-SEASON park row FROM
  THE PITCH LOG → writes `park_factors_seasonal` → re-rolls `Park Factors` automatically. 2026 pitch-log output cross-checks
  vs the TruMedia 2026 single-season set (neutral-site deltas expected). Manual uploads phase out; 2028 = fully pitch-log.
- **BUILD ORDER:** (1) create `park_factors_seasonal` + backfill 2024/25/26 from archived CSVs (per-season, own-year NCAA norm);
  (2) build roll-up → `Park Factors` + DIFF vs current 2026 rows as a sanity check (should be close — current is a 3YR blend too);
  (3) 2026 pitch-log single-season compute + TruMedia cross-check. THEN this whole park build folds into the edge fn.
## ★ PARK TABLE GROUND TRUTH + DECISIONS (2026-08-18)
- **LIVE table = `"Park Factors"`** (quoted, capitalized, 18 cols) — all projection readers (`supabaseQueries.ts`,
  `process-precompute-jobs` edge fn 1016/1315), the importer, point here. Staging holds **2025 (306) + 2026 (309)** rows
  → already MULTI-SEASON (fits: `"Park Factors"` = the stored 3-yr ROLLING output; check what the existing 2025 rows are —
  single-season vs blend — before the roll-up overwrites them).
- **DEAD table = `park_factors`** (lowercase, 12 cols, **0 rows**) — duplicate; referenced ONLY by `google-sheets-sync`
  (2 of 38 from() calls). DROP in audit (#7), COUPLED with stripping just those 2 park_factors lines from google-sheets-sync
  (that fn is LIVE for 8 other tables — do NOT delete it). ⚠ google-sheets-sync also uses lowercase `conference_stats` /
  `power_ratings` — possible SECOND casing-fork to check during the conf-stats build (#4).
- **RLS lockdown DONE (staging):** 6 Stuff+ temp tables (`_confstats_backup,_master_stuff_backup,_ncaa_backup_preanchor,
  _reclass_map,_reclass_pf,_reclass_result`) → `ENABLE ROW LEVEL SECURITY` (service-role-only). Non-destructive; rollback
  preserved; DROP deferred to audit after prod acceptance. Logged to PROD_MIGRATIONS_TODO. [[feedback_claude_runs_backfills_dry_run]]
- **OPEN (Trevor's call): `park_factors_seasonal` own table vs columns on Teams Table.** Agent recommendation = OWN TABLE:
  (a) park factors are already a separate concern with their own table + readers keyed by source_team_id; (b) ~18 factor
  columns (combined/lhb/rhb × avg/obp/iso + rg/whip/hr9) would bloat Teams Table + mix park-environment into team identity;
  (c) the seasonal→rolling relationship is clean as two park tables next to each other; (d) "too many tables" isn't the real
  risk — mixing concerns is. One inputs table beside the existing `"Park Factors"` is the minimal, consistent structure. PENDING confirm.
## ★ PARK SEASONAL + ROLLING BUILT (staging, 2026-08-18) — foundation DONE
- **Schema:** added 10 `*_seasonal` columns to `"Park Factors"` (avg/obp/iso/rg + lhb_/rhb_ avg/obp/iso). Existing 12 factor
  columns = the STORED ROLLING (readers UNCHANGED). One table, two granularities (per Trevor: no 2nd table).
- **Backfill:** `scripts/backfill_park_factors_seasonal.ts` (dry-run default / --apply). Reads archived single-season TruMedia
  CSVs 2024/25/26; per team per cohort raw = mean(hitter,pitcher); **self-normalized per year to that year's 307-team league
  mean ×100** (centers each year ~100, own-league). Quote-aware CSV parser (embedded comma in teamFullName — Hawaii/Indiana
  were column-shifting; DRY-RUN CAUGHT IT). Sparse handed-cohort (R/G≤0.5) → COMBINED fallback.
- **Rolling (2026, g=1 equal weight):** main columns = mean(seasonal 2024/25/26). Verified: Georgia rg_main 109.35 =
  mean(111.28,109,107.76); iso_main 149.75 = mean(148.77,147.61,152.88). Historical rows main=seasonal (degenerate).
- **Cross-check vs prior TruMedia 3YR rows:** mean|Δ| AVG .65 / OBP .38 / ISO 2.1 / RG 2.2; worst ~7pts (Monmouth/Merrimack),
  systematic small offset (my ISO league-mean ~.16 vs their fixed .158 constant → factors a hair lower). Within tolerance.
- **Applied staging:** 922 rows (307/307/308). Backup `_park_factors_backup_20260818` (615 rows, RLS on).
- **STILL TO DO on park (before HTP):** (1) the **2026 PITCH-LOG park compute** — derive the SAME 10 metrics from `pitch_log`
  (venue-attributed), write the 2026 `_seasonal`, cross-check vs the TruMedia 2026 single-season set (neutral-site deltas
  expected) = the acceptance gate + the forward pipeline piece. (2) confirm per-metric projection readers
  (`buildTransferProjectionInputs` avg/obp/iso w/ handedness; `buildTransferPitcherInputs` era/whip/hr9) resolve correctly off
  the rebuilt rolling. (3) games-weighted handoff wiring for LIVE in-season (g<1) — folds into the edge fn. THEN HTP run-env.
## ★ PITCH-LOG PARK COMPUTE — BUILT + GATED (2026-08-18), RG/ISO NEED WORK
- **Built** `scripts/sql/park_from_pitchlog_2026.sql` → `_park_pitchlog_2026_raw` (449 venues). Method: group by
  `game_venue_id`; reconstruct AVG=H/AB, OBP=(H+BB+HBP)/(AB+BB+HBP+SF), ISO=(2B+2·3B+3·HR)/AB from terminal
  `pitch_result_category` PAs; R/G = mean per-game final `max(total_runs)` per side; **50/50 home/visitor blend** per venue
  (mirrors TruMedia hitter+pitcher mean); venue→team = **modal home batting_team_id**; each team's PRIMARY park = max g_home
  (117 teams had a stray neutral venue — resolved; Georgia real park 46g vs 1g neutral). game id = `split_part(uniq_pitch_id,'-',1)`.
- **`home` flag = batting team's home/away** (verified). `total_runs` = batting team's running/final score (verified, but
  disagrees with `current_runs` on some rows — the RG suspect).
- **ACCEPTANCE GATE vs TruMedia 2026 (n=243, primary parks g_home≥10):** AVG mad **3.03**, OBP **2.35** (GOOD — PA
  reconstruction + venue attribution sound), ISO mad **8.49**, **RG mad 6.62 / corr 0.735 (NOISY + systematic flips**:
  Florida A&M 144 vs 92, FDU 97 vs 145, Milwaukee 148 vs 104 — NOT sample-driven, corr(|Δ|,g_home)=−0.41). 28 thin parks (<10g).
- **RG feeds HTP** → must be tightened before pitch-log is the SOLE park source (~2027–28). Prime suspects: `total_runs`
  final-score semantics (vs current_runs); ISO 2B/3B/HR mix. **Does NOT block HTP now** — 2026 park = the validated
  TruMedia upload (phase-in); pitch-log is the forward pipeline + this gate is its validation.
- **DECISION PENDING (Trevor A/B):** (A) fix pitch-log RG/ISO now; (B) log as known gap + proceed to HTP on the validated
  TruMedia rolling, fix pitch-log RG when wiring the edge-fn park stage. Agent leans (B).
## ★ PITCH-LOG PARK — RESOLVED (2026-08-18): home-flag seasonal + multi-year rolling is the mechanism
**Chased the RG/ISO discrepancy to the bottom (Trevor: "make sure it works"). Findings:**
1. **venue_id is FRAGMENTED** — a team's home games split across multiple `game_venue_id`s (Georgia: 33 home games, only 15
   share one id; 3-game weekend-series clusters under different ids; max any team at one venue = 16). ⇒ **do NOT key parks by
   venue_id.** Key by the **`home` flag + `batting_team_id`** (venue-agnostic) → full ~27-game samples (avg 27.4, max 42).
   `scripts/sql/park_home_2026.sql` = `_park_home_2026` (home-flag park compute, both teams' bats in each team's home games).
2. **Single-season park factors are INHERENTLY NOISY** — proven both directions: home-raw (option A) mixes park WITH
   competition quality (FAMU's weak-SWAC pitching makes a pitcher park read neutral: rg 111 vs TM 92, iso 100 vs 66);
   home/ROAD (option B) fails oppositely (Georgia's road games at other SEC hitter parks → schedule confound → Georgia reads
   pitcher). Well-sampled balanced teams match great (Georgia rg 104.8 vs 107.8, iso 151.6 vs 152.9); weak/unbalanced diverge.
   **Isolating park from competition/schedule fundamentally needs a relative baseline AND multi-year** — a known-hard problem;
   exactly why TruMedia ships a 3-YEAR product. Gate (home-flag, n=308): AVG mad 5.3 / OBP 4.0 / ISO 14.3 / RG 11.3, corr ~0.5.
3. **RESOLUTION (fits the architecture we built):** the home-flag compute is the **SEASONAL input**; the **3-yr ROLLING**
   (park_factors_seasonal → Park Factors) is what turns noisy single seasons into a reliable factor. **Keep the TruMedia 2026
   seasonal now** (it's already multi-year-derived + reliable); **accumulate the pitch-log home-flag seasonal each year** so by
   2027–28 the rolling runs on 3 pitch-log years and TruMedia fully phases out — the phase-in, working as designed.
4. **Do NOT judge the pitch-log compute by single-season TruMedia match** — judge it as a seasonal input to the rolling. The
   mechanics are validated (Georgia). **HTP proceeds on the TruMedia-based rolling `rg_factor` now.**
- **Cleanup:** `_park_pitchlog_2026_raw`, `_team_home_park`, `_park_home_2026` = staging scratch (drop after edge-fn park stage built).
- **Edge-fn park stage (future):** run `park_home_2026`-style compute on each new season's pitch_log → write that season's
  `*_seasonal` → re-roll `Park Factors`. Fold into the ONE edge fn. (opponent/park-isolation refinement = later modeling upgrade.)
## ★★★ PITCH-LOG PARK — SOLVED for real (2026-08-18) — SUPERSEDES the "inherently noisy / keep TruMedia / hard" conclusion above
**That earlier conclusion was WRONG.** Trevor pushed ("there needs to be a cause") and the cause was a MISSING FIELD + a WRONG COLUMN, not a modeling limit. The pitch-log park factor reproduces TruMedia across the FULL spread.
- **ROOT CAUSE 1 — never ingested `gameString`.** `gameString` = `cs-<parkcode><date(8)><game#(1)>`, e.g. `cs-air01202604120`. The **park code** (`air01`,`haw01`,`lam01`…) is a STABLE physical-stadium id — unlike `game_venue_id`, which fragments per weekend series. Extract: strip the trailing 9 digits, drop `cs-`. All 308 codes map to EXACTLY ONE home team → **zero neutral-site fragmentation**.
- **ROOT CAUSE 2 — `batting_team_id`/`pitching_team_id` are CORRUPT in the source** (one id → up to 15 teams). The CLEAN ids are **`teamId`→`pitch_log.team_id`** (batting team) and **`opponentId`→`opponent_id`** (pitching team), BOTH already in the DB. My park scripts wrongly grouped by `batting_team_id` → mis-attributed games (Air Force 30 mixed games/13.3 R/G instead of the true 22 `air01` games/18.8). DRS/WAR are UNAFFECTED (DRS references those cols only in comments; ReturningPlayers uses a name-alias map).
- **VALIDATION (park_code + team_id, both-team bats at the park, /league×100):** Air Force 141 vs TruMedia 140 · Northern Kentucky 139 vs 139 · Morehead 138 vs 134 · Hawaii 65 vs 65 · Lamar 64 vs 62 · UC Davis 65 vs 66 · Michigan 69 vs 70. Dead-on hitter AND pitcher parks; every team's dominant code = its full home slate (AFA 22/22, HAW 31/31). ⇒ **The pitch-log CAN produce correct park factors NOW — no multi-year model needed, no road data, no TruMedia dependency.**
- **THE FIX (approved by Trevor):** (1) ingest `gameString` → derive/store `park_code` on `pitch_log` (+ backfill existing rows from source by uniq_pitch_id); store each team's home `park_code` on `Park Factors`. (2) Rebuild the pitch-log park compute keyed by **`park_code` + `team_id`** (NOT batting_team_id, NOT venue_id) — all metrics avg/obp/iso/rg + handedness. (3) Store as the pitch-log seasonal → the rolling. TruMedia phases out cleanly. Source-computed factors: `scratchpad/park_by_code.csv`.
## ★ PITCH-LOG PARK — VALIDATED COMPLETE (2026-08-18)
Rebuilt `scripts/sql/park_home_2026.sql` keyed on CLEAN `team_id` (was corrupt batting_team_id). Gate vs TruMedia 2026:
- **rg corr 0.996 / MAD 0.68 · iso 0.997 · avg 0.994** (all metrics); handedness LHB avg 0.95/iso 0.97, RHB avg 0.99/iso 0.99.
- Spot: Air Force 140 v 140, Georgia 108 v 108, Lamar 62 v 62, Hawaii 63 v 65. **Essentially exact across hitter+pitcher parks.**
- **KEY:** the compute only needs `team_id` + `home` flag (both already in DB) — the `park_code` backfill is NOT required for
  the compute (team_id correctly attributes home games). park_code stays ingested (forward robustness / explicit stadium id).
- **STATUS:** pitch-log park factor = the proven forward mechanism (this SQL becomes the edge-fn park stage). TruMedia 2026
  seasonal STAYS the active value (pitch-log matches it at 0.996, so equivalent — no overwrite per phase-in); pitch-log takes
  over 2027+. 2M park_code backfill DEFERRED (unnecessary now). Scratch: `_park_home_2026` kept; drop `_park_pitchlog_2026_raw`,
  `_team_home_park` in audit. **PARK FACTOR WORK COMPLETE — HTP proceeds on the TruMedia-based rolling rg_factor.**
## ★ HTP + CONFERENCE STATS — COORDINATED BUILD PLAN (#3+#4, Trevor 2026-08-18: "store all of them in the conference stats table")
**Decision: ALL conference-level derived values live STORED in `Conference Stats` (per conference_id × season); NO live compute.**
Kills the HTP-drift problem (currently HTP recomputed live in 4 sites + attached to the transfer conf object).

### Current state (read-before-change)
- **HTP formula (live, 4 copies):** `Hitter Talent+ = OPR + 1.25·(Stuff+−100) + 0.75·(100−wRC+)`.
  Sites: `PitcherPage.tsx:281`, `ConferenceStatsPage.tsx:159` (×10 there), `PitchingConferenceStatsTable.tsx:76`
  (`calcHitterTalentPlus`), displayed in `PitchingEquationsTab.tsx`. Transfer engine `buildTransferPitcherInputs.ts:200/231`
  READS `fromPC/toPC.hitter_talent_plus` — but `Conference Stats` has NO such column, so it's computed live + attached upstream.
  JUCO: `JUCO_DISTRICT_HTP_OVERRIDE` swaps per district (keep).
- **`Conference Stats` columns today:** conference, abbreviation, season, AVG/OBP/ISO/ERA/FIP/WHIP/K9/BB9/HR9, **Stuff_plus**,
  **WRC_plus**, **Overall_Power_Rating**, conference_id, ~40 hitter_/pitcher_ score+pct fields, ba_plus/obp_plus/iso_plus,
  **offensive_power_rating**, SLG/OPS, division, ba_power_rating, slg_plus. **NO hitter_talent_plus, NO run_env_factor.**

### The change
1. **HTP run-env term** (Trevor's ruling): replace `0.75·(100−wRC+)` with a **conference RUN-ENVIRONMENT factor** =
   conf-average of member teams' per-team **`rg_factor`** (the runs park factor from the rolling `Park Factors`), **NO handedness**,
   normalized to 100. New HTP = `OPR + 1.25·(Stuff+−100) + 0.75·(100 − run_env_factor)` (⚠ VERIFY sign/direction at build vs the
   old wRC+ term's role + `project_park_factor_rework` wrc_park modeling — the env term DISCOUNTS talent when the environment inflates raw numbers).
2. **STORE in `Conference Stats`:** add columns **`run_env_factor`** + **`hitter_talent_plus`** (HTP), per conference_id×season.
   (Stuff_plus/WRC_plus/Overall_Power_Rating/offensive_power_rating already there.) Everything the transfer engine + displays need = stored.
3. **Repoint readers to the stored value** (stop live compute): PitcherPage, ConferenceStatsPage, PitchingConferenceStatsTable,
   and the upstream that attaches `hitter_talent_plus` to the transfer conf object → all read `Conference Stats.hitter_talent_plus`.
4. **Conf-stats = a pitch-log BUILD (#4):** recognize the rules, compute EVERY used conf field from the pitch log + the rolling
   park factors, store in `Conference Stats`, fold into the ONE edge fn. Keep the definitional split clean:
   **conf-vs-conf** (wRC+ + raw conference factors → `conference_adjusted_stats`) vs **overall-across-conference**
   (OPR/HTP/Stuff+/run_env → `Conference Stats`). Verify OPR/wRC+ currency (regular season complete → should be accurate).
5. Order: add columns → build the conf-stats pitch-log run (computes run_env_factor + HTP + all conf fields, stored) →
   repoint the 4 readers + transfer engine → fold into edge fn. Then projections read stored HTP everywhere (consistent).
## ★ HTP + RUN-ENV STORED IN CONFERENCE STATS (staging, 2026-08-18) — DB side DONE
- **Columns added** to `"Conference Stats"`: `run_env_factor`, `hitter_talent_plus` (double precision).
- **run_env_factor** = conf-avg of member-team `rg_factor` (rolling Park Factors), joined `Park Factors.source_team_id →
  "Teams Table".source_id (Season 2026) → conference_id`. Populated 30 D1 conferences (range 82.9–115.7); 12 non-D1 null (no park factors). NO handedness.
- **hitter_talent_plus** = `"Overall_Power_Rating" + 1.25·("Stuff_plus"−100) + 0.75·(100 − run_env_factor)` — the NEW HTP
  (run-env term REPLACES the old `0.75·(100−WRC_plus)`). Stored 30 confs. Sanity: SEC 130.3 (old 128.1), ACC 119.9, Big 12
  118.7, Big Ten 113.3 — rankings preserved; run-env (park-only) nudges HTP up vs the old wRC+ term (which conflated talent).
- **CANONICAL HTP confirmed** = uses `Overall_Power_Rating` (NOT offensive_power_rating — that's the drifted ConferenceStatsPage
  copy), `Stuff_plus`, and the env term. Source: `TransferPortal.tsx:491 calcHitterTalentPlusFromConference` (the transfer-engine path).
- **⚠ NOTE on the column name:** the conference name column is literally `"conference abbreviation"` (with a space).
- Backup `_confstats_backup_20260818`.
- **NEXT — REPOINT 6 LIVE-COMPUTE SITES to read stored `hitter_talent_plus`** (kills the drift; makes the run-env change take
  effect in projections): (1) `TransferPortal.tsx:491/1095` calcHitterTalentPlusFromConference; (2) `TeamBuilder.tsx:826`;
  (3) `useTeamBuilderSimulation.ts` resolveConferenceStats; (4) `PitcherPage.tsx:281`; (5) `ConferenceStatsPage.tsx:159`
  (also fix its offensive_power_rating→overall drift); (6) `PitchingConferenceStatsTable.tsx:76` calcHitterTalentPlus.
  Each: add `hitter_talent_plus` (+ run_env_factor) to the Conference Stats fetch, replace the live compute with the stored read.
  Verify: `tsc -p tsconfig.app.json` (no NEW errors) + LOAD the affected pages (per CLAUDE.md). Keep JUCO_DISTRICT_HTP_OVERRIDE.
## ★ OPR + SD-AUDIT NOTES (Trevor 2026-08-18)
- **OPR is NOT a raw hand-upload** (unlike park factors): player `overall_power_rating` is computed in
  `computeAndStoreScores.ts:344` from Masters power ratings (pitch-log-derived). **Conference OPR** (`Conference Stats.
  Overall_Power_Rating`, consumed by HTP) = **PA-weighted rollup** of per-hitter OPR in `scripts/populate-conference-stats-env-plus.ts:119/220`
  — computed, but a SCATTERED script. **#4 conf-stats pitch-log build must ABSORB this rollup** (retire that script) so OPR,
  HTP, run_env_factor, wRC+, all used conf fields land in ONE pitch-log run.
- **★ FUTURE AUDIT (logged, [[project_stuff_opr_sd_audit]]):** verify the standard deviations + NCAA baseline means used in
  Stuff+ AND OPR normalization — if an SD is off, the transfer precompute OVER/UNDER-weights that lever. Compare hand-set
  baselines to empirical pitch-log SDs; recalibrate; confirm transfer-precompute weights land right. NOT now — future note.
## ★ FRAMING CORRECTION (Trevor 2026-08-18) — HTP #3 is DONE; reader-repoint is edge-fn-era, not part of "store HTP"
Agent over-complicated by conflating two things. Straight:
- **PRODUCE + STORE HTP = the #3 task = DONE.** HTP calculated from the data we have (conference OPR + conference run-env
  park factor) and stored in `Conference Stats` (run_env_factor + hitter_talent_plus). Additive/safe — new columns, nothing
  reads them yet, nothing breaks. NO projection-page or Supabase-type work needed to produce+store it.
- **CONSUME the stored HTP = SEPARATE, LATER = part of the ONE edge function / stored-not-live buildout.** The transfer
  precompute (edge fn 6b) reads the stored HTP; the few DISPLAY spots that still recompute HTP live (old wRC+ formula) get
  repointed to read stored AS PART OF that edge-fn/stored-not-live work — NOT a standalone step now. (That's the only place
  Supabase-type-regen + page-load verification applies — and only when we do the edge-fn consumer wiring.)
- **OPR rollup** (`populate-conference-stats-env-plus.ts`) folds into the #4 edge-fn conf-stats run (Trevor: "should be a
  part of the whole edge function").
⇒ Pre-edge-fn levers now essentially staged: PVF stripped, park factors solved+validated, HTP+run-env stored. Remaining
pre-edge-fn = build the #4 conf-stats pitch-log run (absorb OPR rollup + wRC+ + store all), #5 position-of-need, #6 transfer
sync, #7 dead-code audit → THEN the ONE edge function (which does the conf-stats compute + reads stored HTP + projections + snapshots).
## ★★ LIVE-COMPUTE AUDIT (Trevor 2026-08-18: "I am against ANY live computing — log where + how frequently")
Every place the app RECOMPUTES a derived value on the client instead of reading a STORED value. Root anti-pattern behind the
TB oWAR regression ([[project_teambuilder_owar_snapshot_regression]]) + the 3-drifted-copies problem. **FIX for ALL = the ONE
edge function precomputes + stores everything (transfer_snapshot/player_snapshot); every page READS stored, zero client compute.**

### The catalog (files: TransferPortal.tsx, TeamBuilder.tsx, useTeamBuilderSimulation.ts, PlayerProfile.tsx, ReturningPlayers.tsx, PitchingConferenceStatsTable.tsx, savant PitcherPage/ConferenceStatsPage)
1. **HTP / Hitter Talent+** (~15 sites). `calcHitterTalentPlusFromConference` (TransferPortal:491), inline (TeamBuilder:826),
   resolveConferenceStats, PitcherPage:281, ConferenceStatsPage:159 (also OPR-drift), PitchingConferenceStatsTable:76.
   **FREQUENCY: every render / conference lookup / from→to change / roster edit.** ⇒ NOW STORED (`Conference Stats.hitter_talent_plus`);
   repoint these to read stored during the edge-fn/stored-not-live wiring.
2. **oWAR / wRC+ / pWAR** (~19 sites). TeamBuilder + useTeamBuilderSimulation LIVE-REBUILD oWAR (the regression), PlayerProfile,
   ReturningPlayers. **FREQUENCY: every roster edit, every dev-aggressiveness change (full sim re-cascade — CLAUDE.md flags it
   SLOW), every sort/filter, every render.** ⇒ must read `player_snapshot`/`transfer_snapshot` (Step 7c fills them).
3. **Transfer projections** (~14 sites). `buildTransferProjectionInputs` / `buildTransferPitcherInputs` /
   `transferHitter|PitcherProjection` called live in TransferPortal + TeamBuilder + useTeamBuilderSimulation.
   **FREQUENCY: every from/to selection, roster add, filter, preview render.** ⇒ the edge fn (6b) computes these ONCE, stored;
   pages read the snapshot (this is the core Track-B goal).
4. **resolveConferenceStats** (TransferPortal + useTeamBuilderSimulation) recomputes conf-derived values (incl HTP) live per lookup.

### Frequency tiers (worst → mild)
- **Per-roster-edit / per-dev-aggressiveness (heaviest):** TeamBuilder sim cascade (oWAR + projections) — full re-cascade, user-perceptible lag.
- **Per-render / per-filter / per-sort:** HTP, oWAR sorts, projection previews, conf-stat displays.
- **Per-page-load:** initial projection + conf computes.

### Prod implication
The live-compute elimination ships WITH the edge function: (a) edge fn produces stored snapshots (transfer/player) + stored
conf HTP/run-env/OPR; (b) every page repoint = read stored (types regen + PAGE-LOAD verification per CLAUDE.md — the one gate
that needs the dev server); (c) [[project_war_display_audit]] "6 pass-2 choke points" + [[project_stored_derived_values_architecture]]
are the same elimination. Log each repoint in PROD_MIGRATIONS as done. NOTHING computes on a page after this.
## ★ LIVE-COMPUTE AUDIT — 2 CORRECTIONS/REFINEMENTS (Trevor 2026-08-18)
1. **oWAR/wRC+/pWAR live compute = ACCEPTABLE (transient), NOT the anti-pattern.** It's ONLY the immediate post-toggle
   PREVIEW (dev-aggressiveness / roster edit); **the moment the build is SAVED to the DB it reverts to all STORED values.**
   Coach-driven interaction feedback → save → stored. So this is by-design (matches [[project_stored_derived_values_architecture]]
   "small live recompute acceptable for coach-driven changes"). Do NOT "eliminate" it — just ensure save writes stored + read-back is stored.

2. **★ TRANSFER PROJECTION live path = a BUILD-OVER LEFTOVER (Trevor confirmed the pattern: "fixed it but built over top +
   re-used an old function without deleting").** This is the transfer-engine-audit "3 drifted copies." CONCRETE MAP for the
   #6 transfer-sync + #7 dead-code audit:
   - `TransferPortal.tsx:266-268` — `isLegacy`/`legacyEra` branch = old input-format path kept next to the new.
   - **`src/lib/effectiveProjection.ts`** (OLDER: `projectEffectivePitcher`, `effectivePitcherWar`, `effectiveHitterWar`,
     `effectiveMarket`) is PARTIALLY SUPERSEDED by **`src/lib/projectEffective.ts`** (NEWER: `projectEffectiveWar`) — but BOTH
     are still imported; **`PitcherProfile.tsx` imports BOTH** (half-migrated). effectiveProjection.ts also imports projectEffective.ts.
   - **`src/lib/pitcherProjection.ts`** (`projectPitchingRate`/`computePitcherProjection`, the OLD live returner-rate compute)
     overlaps `transferPitcherProjection.ts`; imported by predictionEngine, HighFollowList, TeamBuilder, useTeamBuilderSimulation.
   - Projection fns run in BOTH `supabase/functions/process-precompute-jobs/index.ts` (edge) AND live pages (TransferPortal,
     TeamBuilder, useTeamBuilderSimulation, PlayerHub) — canonical(src/lib)/edge/live triplication.
   - **RESOLUTION (#6/#7, needs page-load verify):** pick ONE canonical projection path, DELETE the superseded module(s)
     (likely retire effectiveProjection.ts → projectEffective.ts; retire the live page compute → read edge-fn snapshot; drop
     the isLegacy branch), repoint all importers, tsc + LOAD each page. Map here = the delete-list. [[project_transfer_engine_audit]]
## ★ PRINCIPLE CORRECTION (Trevor 2026-08-18): it's "BUILD, CHECK, ENSURE IT WORKS, THEN CLEAR" — not "clear then build"
Everywhere this doc/plan says "clear then build" or implies deleting old code first, the correct ORDER is: build the new →
check (tsc/DB/page-load) → ensure it works (A/B vs old) → THEN clear the old. Never delete the working path first; the delete
is the LAST, verification-gated step. Applies to the transfer build-over delete-list, the corrupted-column DROP (after readers
repointed+verified), and the scattered-script retirements (after the unified edge-fn run is proven). [[feedback_build_check_then_clear]]
## ★★ #4 CONFERENCE-STATS UNIFIED PITCH-LOG RUN — DESIGN + PRODUCER MAP (2026-08-18)
Goal: ONE pitch-log-sourced run computes + stores EVERY used `Conference Stats` field per conference_id×season; then (AFTER
verification, per BUILD-CHECK-ENSURE-THEN-CLEAR [[feedback_build_check_then_clear]]) retire the scattered producers. Folds into the ONE edge fn.

### CURRENT PRODUCERS (the things to unify → then retire)
- `src/lib/importConferenceStats.ts` (11 writes) — raw conf rates AVG/OBP/ISO/SLG(/ERA/FIP/WHIP/K9/BB9/HR9) + env+. HAND-UPLOAD CSV path.
- `scripts/populate-conference-stats-env-plus.ts` (28) — env+ (÷ season NCAA), **Overall_Power_Rating = PA-weighted rollup of
  per-hitter overall_power_rating (Hitter Master)**, + Phase-2 JUCO district rows.
- `src/savant/lib/conferenceScoutingAverages.ts` — `offensive_power_rating`, `ba_power_rating`, ~40 `hitter_*`/`pitcher_*` score+pct (scouting averages rollup).
- `src/savant/lib/conferenceStuffPlusV2.ts` — `Stuff_plus` (DONE, V2 pitch-weighted). `conferenceStuffPlus.ts` = V1 → RETIRE.
- `WRC_plus` — producer TBD (grep found no clear writer; likely importConferenceStats or admin or C1-derived — CONFIRM at build; `scripts/sql/wrc_c1_model_config.sql` relates).
- NEW (done): `run_env_factor` (conf-avg per-team rg_factor from rolling Park Factors) + `hitter_talent_plus` (HTP).
- Also write to Conference Stats: `AdminDashboard.tsx` (manual edits — keep as override), `process-precompute-jobs/index.ts` (edge fn).

### UNIFIED RUN — per conference_id × season, from pitch-log-derived sources
1. **Raw conf rates** = PA-weighted (hitters) / IP-weighted (pitchers) rollup of PLAYER rates from Masters (pitch-log-derived),
   NOT a hand CSV. → AVG/OBP/ISO/SLG/OPS, ERA/FIP/WHIP/K9/BB9/HR9.
2. **env+** (ba/obp/slg/iso_plus) = conf rate ÷ season NCAA avg × 100 (ncaa_averages).
3. **OPR** (Overall_Power_Rating) = PA-weighted rollup of player overall_power_rating; **offensive_power_rating** + **ba_power_rating** per conferenceScoutingAverages logic.
4. **Stuff_plus** = pitch-weighted conf Stuff+ (V2, done).
5. **wRC+** (WRC_plus) = C1 formula from conf OBP/SLG (mirror src/savant/lib/war.ts wRC+ C1) — conf-vs-conf.
6. **Scouting averages** (~40 hitter_/pitcher_ score+pct) = PA/IP-weighted rollups of player scouting metrics.
7. **run_env_factor** = conf-avg per-team rg_factor (rolling Park Factors). **HTP** = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor).
8. STORE all in `Conference Stats`. Keep the **conf-vs-conf** (wRC+ + raw factors → `conference_adjusted_stats`) vs
   **overall-across-conference** (OPR/HTP/Stuff+/run_env → `Conference Stats`) split clean.

### BUILD ORDER (each step verified vs current values BEFORE retiring the old producer)
(a) Write the unified rollup (one script/edge-fn stage) → (b) run on staging → (c) A/B each field vs the current scattered-script
values (must match within tolerance; investigate diffs) → (d) verify OPR/wRC+ currency (reg season complete) → (e) fold into the
ONE edge fn → (f) ONLY THEN retire importConferenceStats/populate-conference-stats-env-plus/conferenceStuffPlus(V1)/scouting scripts.
JUCO district rows (Phase 2) handled separately (regional baselines, not D1 pitch-log). AdminDashboard manual edits stay as override.
FIRST BUILD STEP = confirm the WRC_plus producer + the exact conferenceScoutingAverages field list, then write the unified rollup for the RATES + OPR + wRC+ slice, A/B vs current.
## ★ #4 FIRST A/B — conf-rate rollup vs stored upload (2026-08-18): reconciliation needed (denominator weighting)
A/B'd a PA-weighted Hitter Master rollup vs the stored `Conference Stats` rates (n=30): AVG MAD .0085 / corr **0.58**,
OBP MAD .009, ISO MAD .0077 / corr 0.91. ⇒ **ISO ~tracks, AVG does NOT.** DIAGNOSIS: I PA-weighted every rate, but a
conference rate is a POOLED rate over its proper denominator — **AVG & ISO = AB-weighted (or pooled H/AB, XB/AB); OBP =
PA-weighted (reached/PA)**. Weighting player rates by PA gives rate-of-rates ≠ pooled rate → the AVG divergence. **#4 build
detail:** roll up each conf rate by its CORRECT denominator (sum numerators / sum denominators, i.e. Σplayer_H/Σplayer_AB —
or weight by AB for AVG/ISO, PA for OBP; pitching rates IP-weighted). Hitter Master may lack raw AB → derive (AB≈PA−BB−HBP−SF)
or pull H/AB from pitch-log directly. VERIFY the rollup reproduces the stored upload (per-denominator) BEFORE retiring
`importConferenceStats.ts`. This is the concrete first slice of the unified run; the OPR/Stuff+/scouting rollups are
straightforward weighted means (already done for OPR/Stuff+); wRC+ = C1 from conf OBP/SLG; run_env/HTP done.
## ★★★ #4 CORE MODELING RULE (Trevor 2026-08-18) — INTRA-CONFERENCE rates vs TOTAL-SEASON talent/park
**THE critical scope distinction for the conf-stats build. My first A/B (full-season Master rollup) was wrong on SCOPE, not just weighting.**

- **CONFERENCE RATE STATS = INTRA-CONFERENCE GAMES ONLY** (conference-vs-conference): AVG/OBP/ISO/SLG/OPS, ERA/FIP/WHIP/K9/BB9/HR9,
  **wRC+**. Compute from the games where conference teams play EACH OTHER — a direct measure of the conference's internal
  competition level. **NOT a condensed full-season rollup.** From pitch_log: filter to games where batting team's conference ==
  pitching team's conference; aggregate **per-player (conf PA) → per-team → per-conference** (in that order, to scale properly),
  pooled by proper denominator (Σnum/Σden: AVG/ISO by AB, OBP by PA, pitching IP-weighted). These are the `conference_adjusted_stats`
  / conf-vs-conf bucket.
- **STUFF+, OPR, PARK FACTOR (→ HTP) = TOTAL SEASON, ALL GAMES** (weighted — pitches for Stuff+, PA for OPR, pitches/venue for
  park). **Include NON-CONFERENCE** because per-unit sample is small and needs the full season to be stable. **IMPORTANT (Trevor).**
  ⇒ ALREADY BUILT THIS WAY (no rework): Stuff+ = pitch-weighted full season; OPR = full-season PA rollup; park = full-season/3-yr;
  HTP = OPR+Stuff++run_env, all total-season. run_env/HTP stored values are CORRECT as-is.
- **⇒ #4 rate rollup MUST re-scope to intra-conference** (the earlier per-denominator note stands, but the bigger fix is the
  intra-conf FILTER). The talent/park bucket stays total-season. wRC+ = C1 from the INTRA-CONF OBP/SLG.
- **Producers RETIRED after the unified run is verified** (build-check-then-clear): importConferenceStats,
  populate-conference-stats-env-plus, conferenceScoutingAverages, conferenceStuffPlus(V1). Admin edits = override; edge fn absorbs compute.
## ★ #4 BUILD DECISIONS (Trevor 2026-08-18) — ERA solved, conference-game label, team-stats storage Q
- **ERA / earned runs = ALREADY SOLVED** via DRS score-driven ER attribution (`scripts/drs/accrue_pitcher_er.py`): walks the
  pitch-to-pitch SCORE DELTA (catches every run incl. the ~900 the per-play Runs col drops; validated 99.96% vs Master R),
  assigns earned/unearned via `(UR)` movement tags + base-slot responsibility (inherited runners charged correctly across
  pitching changes). ⇒ intra-conf conf ERA = earned runs (this method) / IP × 9. No approximation. (Agent's "ERA is tricky" was wrong.)
- **★ ADD `is_conference_game` flag to `pitch_log`** (Trevor): stored derived boolean = `conference_of(team_id) ==
  conference_of(opponent_id)`, computed on ingest + backfilled (like `park_code`). Makes intra-conf filtering a trivial
  `where is_conference_game` everywhere/forever instead of a Teams Table join each run. Migration + ingest add + backfill.
- **TEAM STATS ARE NOT STORED ANYWHERE** — only `team_war_snapshots` (WAR), `Teams Table` (identity), build tables. No team
  offensive/pitching rate aggregates exist. ⇒ **DECISION PENDING (Trevor):** does the conf-stats run STORE per-team (and
  per-player) intra-conf stats in a new `team_conference_stats` table, or just produce+store the CONFERENCE aggregate with
  team/player as in-run intermediates? Pooling (Σnum/Σden) gets scaling right either way — this is a product/transparency
  choice, not correctness. Conference aggregate = required (transfer engine consumes it).
## ★ #4 STORAGE DECISION + ERA VALIDATION (Trevor 2026-08-18)
- **STORAGE = per-PLAYER conference stats** (Trevor): store each player's intra-conference stats so they're FILTERABLE on the
  Season Stats view; the CONFERENCE aggregate = sum/pool of the per-player conf stats. **Per-TEAM = skipped now** ("not
  necessary but potentially valuable" — future). So: per-player intra-conf split (surfaced on Season Stats) → pooled to
  Conference Stats. `is_conference_game` flag on pitch_log makes the per-player conf filter a trivial `where is_conference_game`.
- **★ ERA / DRS earned-runs = VALIDATED (Trevor asked to confirm).** DRS score-driven ER (`accrue_pitcher_er.py` →
  `scripts/drs/output/pitcher_er.csv`, source_player_id/IP/ER/ERA) vs the Pitching Master OFFICIAL ERA, n=3,878 pitchers
  (IP>10): **corr 0.987 · MAD 0.29 · bias +0.05 (DRS mean 6.54 vs Master 6.49) · 82% within 0.50 ERA.** Per-pitcher tight;
  conference-pool errors average out further → conf ERA from DRS earned runs is reliable. USE it (no Master-ERA dependency).
- **#4 BUILD PATH (locked):** (1) add `is_conference_game` to pitch_log (migration + ingest-derive + backfill, like park_code);
  (2) per-player intra-conf rate stats (pooled by proper denominator; ERA via DRS ER) → store, surface on Season Stats; A/B;
  (3) pool to Conference Stats aggregate + env+ + wRC+(C1); (4) Bucket B reproduce (OPR/Stuff+/scouting/run_env/HTP total-season);
  (5) assemble one pass → fold into edge fn → retire the 5 producers LAST (build-check-then-clear).