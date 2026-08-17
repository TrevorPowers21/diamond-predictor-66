# AGENT LEARNINGS — Stuff+ (2026-08-16)

Companion to the plan in `docs/HANDOFF_STUFF_PLUS_2026_08_16.md`. This is the WHY + the findings + **Trevor's directives
that must survive** — so the next agent builds the classifier off the right principles, not from scratch. Prior receipts:
`docs/TRANSFER_ENGINE_AUDIT_2026_08_13.md` §Bucket 3 + 3b; memory `project_transfer_engine_audit`, `feedback_stuff_plus_*`.

## Why Stuff+ matters (the currency)
Stuff+ = the **competition-translation currency**. Pitch-shape-based, context-independent, one national D1 baseline. It
is load-bearing in three places: (1) a pitcher's own talent, (2) the **pitching depth** of every conference/region
(the roll-up), (3) the **opposing-quality lever in the transfer engine** — hitters projected vs a destination's pitching
Stuff+, pitchers vs HTP (built from Stuff+). So ANY distortion in Stuff+ — a mis-centered baseline, a wrong sign, a
mis-classified pitch, a stale conference copy — propagates into **wrong projected values a coach can't see.** The whole
product value ("what is this player worth at THIS level") rides on this yardstick being accurate.

## ★ TREVOR'S DIRECTIVES (the important calls — preserve these)
1. **TrackMan auto-tags pitch type by VELOCITY → the source `pitch_type` is UNRELIABLE.** A slow pitch gets labeled
   "Change-up" regardless of its shape; a hard one a fastball. **So reclassify off MOVEMENT + velo-separation, NEVER the
   incoming tag.** This is the entire reason reclassification exists.
2. **Sinkers tagged as 4S are DOUBLE-penalized, and it's a compounding fix.** They're scored on ride-heavy 4S criteria
   (their low ride reads "bad") AND they pollute the 4S population so "average" is dragged down. Pulling them out helps
   **BOTH** groups: true 4S guys score better vs a cleaner (higher-ride) baseline, and sinkers finally get scored as
   sinkers (arm-side run + drop rewarded). *"It also improves true 4-seam fastball guys because of what we consider
   average."*
3. **Low-velo "fastballs" that tumble are change-ups** — especially at lower levels *("some guys throw 84 mph fastballs
   that move like a CH")*. Velo alone won't separate them → need movement + velo-separation from the pitcher's own FB.
4. **"0 HB, −6 IVB = a dope gyro slider."** This is a CLASSIFICATION threshold; it pairs with the calc rewarding that
   depth. Classification and scoring are designed together.
5. **Curveball HB sign is a bug** — glove-side break should be positive (like Sweeper's +0.40), not −0.15 (`:247`).
6. **Gyro slider vertical break should be REWARDING** (depth), paired with the gyro classification threshold (`:173`).
7. **THE THEME across ALL these fixes:** *"something got improved and just built upon instead of cleared then built."*
   There must be **ONE correct process** — *"it is the pitch-log process and nothing else."* Retire the leftovers (V1
   conference Stuff+, scattered one-off scripts); the pitch-log method is canonical.
8. **Don't change outputs twice** → do Stuff+ **before** the recompute so transfer projections land on the final numbers
   ONCE. (Not by rushing or freezing a known-wrong classifier — by doing Stuff+ right, then recomputing.)
9. **Overarching goal:** ONE full function from **pitch-log upload → transfer projection**, running on every update and
   storing everything in the DB. **This dissolves the "change twice" fear** — the fear is really the current *painful
   manual* recompute; once it's one function, a future Stuff+ improvement is just "edit the formula, next update re-runs
   it," like any routine update. So building the one process is what makes deferring/iterating Stuff+ safe.
10. **Stuff+ is its own edit,** and the **classification is the heart of it** — a necessary function, not a coefficient
    tweak. Only the curveball sign is trivial.

## Findings (audit 2026-08-13 + this session)
- **Math is TRUSTWORTHY** (per-pitch z vs a D1-clean baseline per pitch-type×hand, recentered to 100, pitch-weighted
  composite + conference). This edit is CLASSIFICATION + 2 calc bugs + pipeline consolidation, NOT a rebuild.
- **Weighting fork OPEN but parked this pass:** recenter is per-pitcher UNWEIGHTED (`stuffPlusEngine.ts:450`). Pitch-
  weighting would drop every FB/SI ~3-6pt (good arms throw more) — a real recalibration, not just small-sample cleanup.
  Stays unweighted for now; small-sample noise is a display-floor issue, not a weighting bug.
- **Curveball** `:247` = `hbSign·(−0.15)·zh` vs Sweeper `:230` `hbSign·(0.40)·zh` — the sign bug, confirmed in code.
- **Gyro slider** `:173` rewards depth via `zi = −ziRaw` (weight 0.15); gyro classification threshold to revisit.
- **No fastball reclassifier exists** — `breakingBallReclassification.ts` covers breaking balls only. Fastball family is
  a NEW classifier following that pattern (`rstr_pitch_class`, review flags, consolidation).
- **The engine dispatches calc off the pitch_type field** (`:423`, `calculateStuffPlus(row.pitch_type,…)`), reading
  `pitcher_stuff_plus_inputs.pitch_type`. So the reclassifier must feed the engine the CORRECTED class (not the raw tag).
- Gyro non-z HB term = correct as-is; dead inputs (vaa/whiff/gyro_stuff_plus) normal — no action (audit).

## The reclassification approach (how to build it without bogging down)
- Extend the `breakingBallReclassification.ts` pattern to the fastball/offspeed family.
- Rules on velo + IVB + HB (+ **velo-separation from the pitcher's own fastball** for change-ups).
- **Draw boundaries from real data**, not guesses: pull the IVB/HB/velo distributions of what's currently tagged
  4S/Sinker/Cutter/Change-up (`pitcher_stuff_plus_inputs`), find the clusters, set thresholds there.
- **Validation loop** (the trust step): spot-check a known sinkerballer, a true 4S guy, a change-up guy, and the
  0-HB/−6-IVB gyro. Rule-based + `needs_review` flags for boundary cases (like the breaking-ball reclassifier).

## ★ EXTERNAL REVIEW refinements (2026-08-16) — adopt the METHOD, set NUMBERS from our data
An outside review of the synopsis (all equations + the classification problem) returned strong method fixes. Adopt these:
- **★ STEP 0 — venue/sensor-variance check BEFORE any absolute threshold.** Park-level TrackMan calibration variance is
  plausible (the framing park work showed venue effects). Fixed-inch IVB/HB cuts inherit whatever each park's unit reads;
  a hot-reading park flips every borderline fastball/sweeper in its home data. Minimum viable: per-venue mean IVB/HB
  residuals off pitcher-season means (same visiting-pitcher logic as the framing park fix); if any park ≥ **1.5″**
  systematic offset, correct BEFORE classifying. One query, and every boundary then sits on trusted data. [[project_park_factor_rework]]
- **Sequence matters: classify SWEEPER out FIRST, then set the Cutter/Slider boundary on what remains** (removing sweepers
  tightens the slider cluster + cleans the CT/SL valley).
- **Cluster-level labeling, per-pitcher.** ≥ ~150–300 pitches/arm → cluster that pitcher (est. 3–6 centers from 300 pts is
  easy); < ~150 → fall back to global boundary rules applied to the pitcher's per-cluster MEANS, **never per-pitch**. One
  label per cluster (a changeup cluster with a few killed-spin outliers is still one changeup, not a phantom splitter).
- **Velo-gap boundary at the cluster VALLEY, not inside a tail.** Review's read of the doc: true cutters ~3.1 mff, true
  sliders ~7.8 → valley ~**6** (a "<5=cutter" line spills 4.5–5.5-gap cutters into sliders). **Cut ~6** with movement
  conditions (HB < ~6, IVB > ~4). ⚠ **These specific numbers are the review's — CONFIRM against our own venue-corrected
  clusters before locking.**
- **Binary arsenal tiebreaker** for the 5–7 mff ambiguous band: 2nd distinct breaking ball exists → **Cutter**; only
  breaking ball → **Slider**. Decisive, not advisory.
- **Release-height conditioning on the SWEEPER threshold too** (a sidearmer's ordinary slider gets huge HB from the slot;
  a flat 12″ line tags every low-slot slider a sweeper). Condition HB bar on release height, or define sweep relative to
  the pitcher's release-driven expectation. Sweepers run ~9–12 mff (slower than gyros off the same FB) → velo-gap is a
  free confirming feature.
- **4S/Sinker IVB bands conditioned on release height** (review's proposal, confirm on our data): low slot < 5.2 ft → FF
  line ~10 IVB; 5.2–5.8 → ~12; > 5.8 → ~13. Ambiguous 9–12 band decided by HB + the cluster-consistency rule.
- **⚠ Handedness check BEFORE wiring:** verify HB "arm-side run" is handedness-normalized in the pipeline, else the
  "arm-side ≥ 12″ = sinker" condition silently fails for lefties. One-line check.
- **Two named hard cases = known-ambiguous archetypes, log with documented tiebreaker, do NOT let them block the build:**
  (a) 86–88 cutter-shaped hard slider off a 92 FB (4–6 gap + cutter movement → cutter if he owns a 2nd breaking ball, else
  slider); (b) low-slot sinker/4-seam straddler (resolves via the release-height bands + cluster-mean labeling).
- **★ PROVENANCE (confirmed by Trevor 2026-08-16): the review's specific numbers were MADE UP from general baseball
  knowledge — NOT from any distributions we pulled.** There was no distributions doc; the review invented plausible
  cutpoints (cutter ~3.1 / slider ~7.8 mff, 41%, 10/12/13 IVB bands, 1400 rpm, valley-6) from domain priors. So: treat
  them ONLY as **directional sanity-check ranges** (a cutter ~2–4 mff off the FB, a slider ~6–9 is standard pitch-design
  lore) — if our real clusters land far from these, investigate. **The ACTUAL boundaries come from OUR pulled,
  venue-corrected clusters, full stop.** First real execution move = pull the distributions ourselves + run the venue
  check; nothing in the numeric proposals is measured.

## ★ RECLASSIFICATION BUILD CONDITIONS (external review round 2, 2026-08-16) — these are REQUIRED, not optional
**Forced build order (not parallel):**
1. **Venue movement check** — per-venue mean IVB/HB residuals off pitcher-season means (visiting-pitcher logic, framing
   park fix); any park with ≥1.5″ systematic offset is corrected BEFORE any boundary is drawn.
2. **Handedness-normalization audit on HB signs** — the "SI 13+ run" condition silently fails for LHP if HB is raw. Verify first.
3. **Per-pitcher clustering** — classify at the CLUSTER level, never per-pitch; sub-150-pitch arms fall back to global
   rules applied to the pitcher's cluster MEANS.
4. **Extract SWEEPER first.**
5. **Then set CT/SL on the REMAINING slider population** (removing sweepers moves the slider cluster — boundary set after).
6. **SI/FF and CH/SPL** in either order.
7. **Acceptance panel** (gates below).
→ **Report the venue-check + clustering results back BEFORE boundary application.**

**`classification_version` in the provenance chain:** stamped on every pitch-level output row alongside `constants_version`;
stale-guard REFUSES to combine mismatched taxonomies. **Reclassification is a BREAKING SCHEMA change, not a data fix** —
every downstream consumer of pitch type (per-type Stuff+ means, arsenal differentials, mix displays, per-type goldens,
persistence tables) re-derives against the new taxonomy in the SAME pass; **no old-bucket means survive anywhere.**

**Historical scope (amended by Trevor):** one taxonomy across all pitch-level data we have = **2026 only (no 2025 pitch
logs exist).** DOCUMENT as a known limitation: any pitch-type-keyed persistence / YoY values built from 2025-era data
carry a **taxonomy seam** until 2025 logs are acquired; if they land, same-ruleset reprocessing is day-one work.
**Acquiring 2025 logs = a logged data-acquisition item.**

**Pre-registered acceptance gates (before wiring):** (a) CT/SL confusion below a stated rate on a manual spot-check;
(b) a **named-arms panel** (~20 pitchers Trevor knows cold — Trevor supplies the list) labels correctly; (c) within-season
stability — same pitcher's same pitch holds one label all season (cluster labeling makes this ~free; assert it anyway);
(d) league-level type mix per role passes eyeball review.

**Exceptions path from day one:** a **classification confidence field** on every assignment; far-from-cluster pitches,
non-separating arms, and fallback-rule pitchers land in a **classification exceptions log** (the `NEW_VOCAB` pattern from
the atbatDesc parser is the template). **Nothing silently forced into a bucket.**

## ★ THE PARTITION (v1, Trevor 2026-08-17) — full spec in HANDOFF_STUFF_PLUS "THE PARTITION"
10 buckets, exhaustive over (gap, armHB, IVB) + spin for CH/SPL. **Headline additions from Trevor:** the CURVE family
splits into **12-6 Curveball vs Sweeping Curveball** (a downer and a two-plane breaker are different pitches, same as
gyro vs sweeper); the **topspin-forces-entry blend rule** (IVB ≤ −8 at any gap = curve, graded as a hard curve); the
**gyro/curve blend strip** (low HB, IVB −4→−8, gap decides). **Thesis to preserve: each bucket its own equation, so a
below-average pitch grades poorly IN its correct room, never exiled to the wrong bucket.**

**Agent improvements folded into the spec (why):**
1. **Unify the HB sign convention** — the spec mixed `IVB−|HB|`, "arm-side" (signed), and "HB 12+" (glove-as-positive).
   Store `armHB` = arm-side-positive; every rule reads it. Without this the sweeper/sinker conditions silently invert by
   hand. (This is the handedness audit, concrete.)
2. **Arm-side vs glove-side = the explicit first cut** after gap → offspeed vs breaking. Dissolves the gap-range overlaps
   (offspeed 6-14 vs slider 5-11 vs sweeper 8-13 all overlap in gap; HB side separates them cleanly).
3. **Gap anchor = the pitcher's HARDEST fastball**, two-pass (identify primaryFB first, then gap-classify). A CH off a 94
   is a 10-gap even if he also throws a 92 sinker.
4. **CT/SL seam = joint (gap, IVB≥+5)** — retained ride is the true cutter signature at the 5-8 overlap, not gap alone.
5. **Sweeper HB bar stays slot-conditioned** — `IVB−|HB|` is more slot-robust than absolute-IVB bands (may reduce FF/SI
   slot-conditioning), but a sidearmer's ordinary slider sweeps 12+ from arm angle, so the sweeper line still needs it.
6. **Two-layer assignment:** boundary RULES give the primary label; **nearest-centroid** (data-derived bucket centers,
   post venue-check) is the FALLBACK for boundary/low-confidence pitches; low-confidence flag + exceptions log; never
   defaults to slider.
**Open Qs (Trevor):** bucket count 10 vs 11 (slutter/gravity-ball = sub-flag or its own equation?); slutter graded cutter
(IVB≥+5) vs slider eq; VAA as a seam tiebreaker (unused today) vs strict (gap,HB,IVB,spin). Numbers validate on our data.

## Sequencing + deferred
- Stuff+ edit → **before Step 6b** (so the transfer recompute lands on final Stuff+). Then 6b → 7 → Step 8.
- **Deferred to a later "big Stuff+ conversation"** (NOT this edit): velocity/spin conventions; OPR batted-ball
  context-adjustment (ties to park factor); **OSU-faced-schedule** — conference quality should be the teams a pitcher
  ACTUALLY faced, not the overall average (same insight as a possible **Stuff+-faced-per-hitter** metric); the
  weighting-fork philosophy.
