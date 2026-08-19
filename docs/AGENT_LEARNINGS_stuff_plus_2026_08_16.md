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
**9 buckets** (FF, SI, CT, gyro, SL, SW, CB, CH, SPL), exhaustive over (gap, armHB, IVB) + spin for CH/SPL. **Headline
moves:** the CURVE family is **ONE bucket, both shapes** (12-6 + sweepy) — the sign-fixed curveball eq pays depth
(`−0.30·z(ivb)`) AND sweep (`+0.15` glove-side), so it grades both fairly; splitting was UNNECESSARY (unlike slider vs
sweeper, whose sweep/bullet-depth ARE opposing under one formula → they split). The **topspin-forces-entry blend rule**
(IVB ≤ −8 at any gap = curve); the **gyro/curve blend strip** (low HB, IVB −4→−8, gap decides). **Thesis: each bucket its
own equation, so a below-average pitch grades poorly IN its correct room, never exiled.** ⇒ **THE FULL FINAL EQUATIONS
(all 9, verbatim replacement of the calc set) live in `HANDOFF_STUFF_PLUS` → "FULL FINAL EQUATIONS".**

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
**RESOLVED (Trevor 2026-08-17):** **9 buckets** (curve collapsed to ONE; slutter, gravity-ball, AND sweeping-curveball =
display sub-flags, NEVER equations). **Slutter grades with the SLIDER equation** (cross-bucket grading breaks per-bucket
recentering — one room, one equation). **VAA/HAA = RESERVED, NOT derived (RULING 2026-08-17)** — per-pitch VAA is in NO current
export (verified); an approximation would seam vs the real tracked VAA in future local-TrackMan uploads (worse than none),
so **cluster-mean labeling carries the SI/FF strip now**; VAA drops in as the strip tiebreaker when real VAA/HAA arrive
(recorded decision, no redesign; computes off venue-corrected layer + unlocks VAA/HAA replacing `zAbs(relH/relS)`). No VAA
in any equation/boundary until then. **Equation change-list (vs current):** curveball HB
sign fix (−0.15→+0.15); cutter ivb `zAbs→z` (signed, ride-only bucket); **`z(fb_gap)` added to gyro/slider/sweeper/
curveball** (velo/spin weight shaved to fit); 4S/Sinker/Changeup/Splitter untouched. **`z(fb_gap)` = z vs the
bucket-OPTIMAL gap distribution, NOT one-sided/maximal** — an outsized gap is a classification question, not a bonus.
All numeric thresholds validate on our venue-corrected clusters.

## ★ THE FULL PIPELINE + KEY PRINCIPLES (Trevor 2026-08-17) — diagram in `PIPELINE_pitch_log_to_projections.md`
The "one process": pitch-log upload → derive → Stuff+ → power ratings → conference baselines → projections → NIL/display.
**Non-negotiable principles Trevor stated (must survive):**
- **The pitch log is the PRIMARY (highest-frequency) source of truth — NOT the only one.** The Masters' power-rating
  INPUTS — hitter batted-ball + discipline metrics AND pitcher rate stats — are pitch-log-derived and **married onto the
  Masters** (not native Master columns). So the power ratings + `desc_owar/d_war/bsr_war/total_desc_war`/`desc_pwar` all
  trace to the pitch log. `pull_air/in_zone/spray/zone` = derived-then-married (confirmed).
- **★ Hitting/Pitching Master OVERRIDES exist (Trevor 2026-08-17).** In some scenarios a Master-level override supplies
  what the pitch log can't — **baserunning especially, plus some other fields** — uploaded **less frequently than the
  pitch log**. The re-derive pass is pitch-log-primary but **override-aware**: where an override exists it WINS and the
  pitch-log re-derivation must NOT clobber it (same merge-not-overwrite discipline as preserving coach toggles). Rare
  exception, not the norm.
- **Conference Stuff+ (V2) = pitch-weighted mean of EVERY pitcher in the conference, FULL season**
  (`Σ(pitcher Stuff+ × pitch count)/Σ(pitch count)`) = the conference's PITCHING DEPTH. **Conference HTP** = same for
  hitters (aggregate hitter talent, all teams, full season). **Conference stats are CONFERENCE-vs-CONFERENCE only** — the
  conference is the comparison unit; that ranking is what the projection competition-translation lever consumes.
- **Projections must FILL `player_snapshot`/`transfer_snapshot` WITHOUT changing toggles** (dev aggressiveness, roster
  status, class transition, cornerstone) — never reset them — and **refresh ALL displayed metrics to current values**
  (= Step 7c).
- **Savant is DEAD/unused → clear after this** (logged to memory). Live pitch-log surface = the **Season Stats display**;
  all its stats/filters/visuals must be pitch-log-derived + stored current.
- **Park factors = re-evaluate AFTER Stuff+, quick.** [[project_park_factor_rework]].
- **The unification goal:** ONE function on ingest runs derive→Stuff+→ratings→conference→projections, stamped
  classification_version/constants_version, re-deriving every aggregate in the same pass (no stale scattered scripts).

## ★ THE GATE CAUGHT TWO REAL GAPS (2026-08-17) — why the comparative check is load-bearing
The human-memory panel died (Trevor can't rattle 20 arms cold) → replaced by a 4-check ground-truth lock gate. **Consistency
≠ correctness:** a misplaced boundary passes every stability/coherence/mix check — stable, coherent, and wrong. The
comparative gate (Check 1: TrackMan stability benchmark, MANDATORY, STOP if TM ties/beats us anywhere) is the ground-truth
catch. **It fired twice, both on failure modes the consistency checks were structurally blind to:**
1. **The implementation had quietly drifted from the LOCKED cluster-then-label architecture to a per-pitch shortcut.** Check 1
   FAILED breaking (0.816 vs 0.858) — per-pitch labeling flips seam-straddlers; our 4 breaking buckets carry 3 internal seams
   to TM's coarse-and-trivially-stable 1. The failed prediction went ON RECORD as written (never buried). Rebuilt to the real
   cluster-level design → Check 1 re-run WON ALL FOUR (overall .860 v .822; breaking swung **+0.15**). **The loss was the
   shortcut, never the taxonomy.** Honest deviation: the prediction's "gap concentrates in breaking" clause did NOT hold — our
   biggest edge is **FB (+.062, sinker extraction)**; breaking is a narrow win (TM breaking tags steadier than the thesis).
2. **Absurdity golden caught the CB rule stealing arm-side-deep pitches** (hard sinkers/screwballs +11..+18 armHB were labeled
   "curveball"). Fixed: CB = `IVB≤−8 AND armHB<4 (glove/neutral) AND gap≥4`; arm-side-deep → offspeed; fastball-velo depth →
   REVIEW/exceptions (never force-labeled).
**Second time pre-registered discipline caught a finish-line gap (SS −1,141 was first); both from the check someone might have
called redundant.** [[feedback_predictions_on_record_at_right_grain]] [[feedback_stop_and_talk_on_real_problems]]

## ★ ANCHOR-BASED ARSENAL CONSTRUCTION (Trevor 2026-08-17) — the merge-rule replacement, a real architecture principle
**Full spec in HANDOFF_STUFF_PLUS "ANCHOR-BASED ARSENAL CONSTRUCTION".** A pitcher's arsenal = his **ANCHOR pitches**
(high-usage ≥60p or ≥10% mix, clearly separated in movement space); everything marginal **gravitates to its nearest anchor**
("gravity toward the main pitch") instead of standing alone. Residual clusters fold into the nearest anchor by **multivariate
proximity** (inherit its label), with a **velo-gap family GUARD** (a changeup never folds into a slider — same speed+sweep =
one pitch varying finish; same movement+different speed = two pitches). **Far-outliers → exceptions log** (kid experimenting
still seen). **Replaces** the univariate Δ3.5-IVB merge (dies); **generalizes** distance-bounded folding to the 97-pitch case
(proximity does the work, not size). **New golden:** no near-0-armHB slider. **Gibler = the acceptance case** (290 gyro anchor
+ 97 depth folds in → one gyro ~387p + gravity-ball flag, one 4S, one CH). **Stability should improve by construction**
(depth-varying breaker lands in same anchor both halves, not split on tilt). Display: anchor shows, folded pitches counted in.

## Sequencing + deferred
- Stuff+ edit → **before Step 6b** (so the transfer recompute lands on final Stuff+). Then 6b → 7 → Step 8.
- **Deferred to a later "big Stuff+ conversation"** (NOT this edit): velocity/spin conventions; OPR batted-ball
  context-adjustment (ties to park factor); **OSU-faced-schedule** — conference quality should be the teams a pitcher
  ACTUALLY faced, not the overall average (same insight as a possible **Stuff+-faced-per-hitter** metric); the
  weighting-fork philosophy.

## ★ PHASE 2 EXECUTION + D1 FINALIZATION — LEARNINGS (2026-08-17)
Full current-state + next: `docs/STUFF_PLUS_RESUME_2026_08_17.md`. The chain (reclassify → baseline → fold → recompute →
roll up) is INTERDEPENDENT and must land together — a half-migration = wrong Stuff+ everywhere (same failure class as the
TB oWAR bug: a half-migrated state showing wrong numbers).

**What was done, in order:** (1) reclassification WRITE (2M `pitch_type_reclassified`, stamped `v1-anchor-2026-08-17`) —
anchor labels built as a `_reclass_map` (pitcher×seed→label), materialized to `_reclass_result`, applied via UPDATE.
(2) baseline re-derived on the new taxonomy via DIRECT SQL (two-level: per-pitcher agg → pitch-weighted mean/sd), `hb`
column = armHB, `velo_diff` = gap (bypassed the deriver scripts, which read stale `pitcher_stuff_plus_inputs`). (3) folded
the 9 calc functions in `stuffPlusEngine.ts` + modified `compute_pitch_log_stuff_plus.ts` (primaryFB velo from `_reclass_pf`;
read `pitch_log_corrected`; armHB + gap-for-all; re-score all v1-anchor) → 2M recompute, bucket means ~100. (4) rolled up
per-player→Master + conference V2→Conference Stats DIRECTLY from pitch_log.

**★ KEY LEARNINGS (durable):**
- **BIG-WRITE MECHANICS:** the staging pooler HARD-cancels any single statement >120s and IGNORES `statement_timeout=0`. To
  write ~2M rows: DROP index on updated cols (enables HOT), materialize (CTAS), then batch by slicing the SMALL driving table
  by `ctid` — filtering the BIG table's ctid or a hash-mod re-scans the 2M join table every batch and times out. **A TS
  script's batched REST upserts (keyset pagination) are timeout-IMMUNE — the right tool for the 2M `stuff_plus` write.**
- **THE INTERMEDIATE MATTERS:** the baseline deriver AND both rollups read `pitcher_stuff_plus_inputs` (per-pitcher aggregate),
  NOT pitch_log. Re-deriving Stuff+ from pitch_log leaves inputs STALE → either re-aggregate inputs (pipeline-consistent) or
  roll up directly from pitch_log (chosen: correct + lower risk than DELETE/replace on the shared table; inputs re-agg → Track B).
- **VALIDATION BEAT VIBES:** means-at-100 is necessary-not-sufficient. The leaderboard surprise (sub-85mph arms at top) was
  NOT a bug — velo↔Stuff+ corr **+0.54**, velo bands monotonic (93+→114 / <85→97), and the top low-velo arms were legit
  elite-shape (Combs's −6.4 IVB changeup = 13" more drop than baseline). Cleaner buckets tightened breaking-ball SDs →
  amplified movement rewards (shape-forward). Verify a surprise with a component/correlation breakdown before calling it a bug.
- **JUCO:** separate conferences + separate pipeline (D1 baselines applied to JUCO data; NOT in D1 pitch_log). D1 finalization
  never touches or mixes JUCO; JUCO recompute stays FROZEN.
- **REVERSIBLE:** backup before every destructive write (`_ncaa_backup_preanchor`, `_master_stuff_backup`, `_confstats_backup`).

## ★ PROJECTION-EQUATION LEVERS + "STORED-NOT-LIVE" PRINCIPLE (Trevor 2026-08-18)
Full plan: `HANDOFF_STUFF_PLUS` §PRE-EDGE-FN PLAN. Context: after Stuff+ finalized, before firing the transfer edge fn (6b),
EVERY other lever must be final (don't-change-twice). Trevor's directives that must survive:

- **★ STORED, NOT LIVE — the load-bearing principle.** Trevor: *"I hate any live computes on one singular page that isn't
  stored in the transfer snapshot and consistent in the database."* Every derived value (HTP, park term, position-of-need
  premium, projections) must be STORED in the snapshot / a canonical table and read from there — never recomputed live on one
  page. This is the SAME root cause as the TB oWAR regression ([[project_teambuilder_owar_snapshot_regression]]) and the
  3-drifted-copies problem. The end goal is ONE edge function start-to-finish (Track B) that computes conf stats → HTP/park →
  projections → snapshots, all stored.
- **★ PARK FACTOR HAS TWO USES — do not conflate:** (1) HTP run-environment term = a conference-average **RUN** factor
  (replaces `100−wRC+`); (2) per-metric PROJECTION adjustment = **PER-METRIC** park factors — you project batting AVERAGE
  park-to-park, NOT runs, so AVG/OBP/ISO each get their own factor (pitching ERA/FIP use the run factor). Per-metric factors
  already resolve via `resolveMetricParkFactor` (parkFactors.ts).
- **★ PARK DATA = manual 3-YEAR ROLLING (stable) NOW; pitch-log venue-specific is DEFERRED.** Parks need multi-year to
  settle; the pitch log gives venue-specific factors but only 2026 (1 yr = too noisy), and we lack 2024/25 without imports.
  Use the existing manual 3-yr factors; the pitch-log venue-specific (per-player + per-venue) rework is gated on importing
  prior-year pitch logs. [[project_park_factor_rework]]
- **PVF DROPPED:** the weekend-SP `1.2×` premium double-counts (a starter's role value is already in WAR via IP). Strip it
  from the edge fn to match canonical. Any starter/position premium lives in the Team Builder setting only (to discuss).
- **POSITION-OF-NEED must be STORED** (not live): Trevor leans toward a coach-declared "positions of need" pre-offseason
  POPUP → stored → raises per-player value where p70 isn't a starter at that declared position (vs across-the-board). Decide
  + store before wiring the need premium. [[project_player_score_nil_allocation]]
- **HTP STORED** per conference×season (kills the 3-copies drift). **Conference stats:** check/finalize + stabilize + fold
  into the edge fn start-to-finish; keep conf-vs-conf (wRC+/raw factors, `conference_adjusted_stats`) vs overall
  (OPR/HTP/Stuff+, `Conference Stats`) clean — the definitional mismatch.

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
## ★ PARK-FACTOR FROM PITCH-LOG — DURABLE LEARNINGS (2026-08-18)
The long "why don't pitch-log park factors match TruMedia" dig. Answer: NOT a modeling limit — two data issues. Learnings:
1. **`gameString` is the park key, NOT `game_venue_id`.** gameString = `cs-<parkCode><date8><game#1>` (e.g. `cs-air01202604120`).
   parkCode (`air01`) = strip trailing 9 digits + `cs-`. It's a STABLE stadium id; `game_venue_id` FRAGMENTS per weekend
   series (a team's home games spread across ~13 venue_ids). All 308 park codes map 1:1 to one home team → NO neutral-site
   fragmentation. We never ingested gameString — now do (ingest_pitch_log.ts parkCodeFromGameString → park_code column).
2. **`batting_team_id`/`pitching_team_id` are CORRUPT** in the TruMedia source (1 id → up to 15 team abbrevs). The CLEAN ids
   are **`teamId`→team_id (batting)** and **`opponentId`→opponent_id (pitching)**, both already ingested. ALWAYS use team_id/
   opponent_id for team attribution from pitch_log; NEVER batting_team_id/pitching_team_id. (My park scripts used the corrupt
   col → Air Force mis-counted 30 mixed games/13.3 R/G vs the true 22 air01 games/18.8.) DRS/WAR unaffected (comment refs only).
3. **Park factor = both teams' bats AT the park / league ×100, keyed park_code + team_id.** No road data, no multi-year model,
   no opponent adjustment needed for D1 single-season — it MATCHES TruMedia (AF 141v140, NKU 139v139, Hawaii 65v65, Lamar
   64v62, Michigan 69v70; hitter AND pitcher parks). The earlier "single-season inherently noisy / keep TruMedia / it's hard"
   conclusion was WRONG — it was the venue_id fragmentation + corrupt id, not noise.
4. **METHOD DISCIPLINE (Trevor):** when a computed value is off but the source "collects all the proper data," there is a
   CAUSE (missing field / wrong column / missing games) — find it, don't retreat to "it's fundamentally hard." Georgia matching
   exactly was the tell that the method was right and the DATA/wiring was wrong. [[project_park_factor_rework]]
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
## ★★ CONFERENCE-STATS BUILD (#4) — CONSOLIDATED FINDINGS + PLAN (2026-08-18)
Full running plan in `docs/HANDOFF_STUFF_PLUS_2026_08_16.md` (§#4 sections). Durable learnings:

### THE SCOPE RULE (load-bearing) — [[project_conference_stats_scope_rule]]
- **Conference RATE stats = INTRA-CONFERENCE games ONLY** (AVG/OBP/ISO/SLG/OPS, ERA/FIP/WHIP/K9/BB9/HR9, wRC+). Games where
  conference teams play EACH OTHER — a direct conf-vs-conf competition measure, NOT a condensed full-season rollup. Filter
  pitch_log to `conference_of(team_id) == conference_of(opponent_id)`, aggregate per-player (conf PA) → per-team → per-conference,
  pool by PROPER denominator (Σnum/Σden — AVG/ISO by AB, OBP by PA, pitching IP-weighted). wRC+ = C1 from intra-conf OBP/SLG.
- **Stuff+, OPR, Park Factor (→ HTP) = TOTAL season, ALL games**, weighted (pitches/PA/venue) — small per-unit sample needs the
  full season. ALREADY BUILT THIS WAY; run_env + HTP stored values CORRECT as-is; OPR is a total-season PA-weighted rollup (no rework).

### FINDINGS
- **My first A/B error (instructive):** a FULL-SEASON Master rate rollup does NOT reproduce the stored conf rates (AVG corr 0.58)
  — wrong on SCOPE (should be intra-conference) AND weighting (per-denominator). Caught BEFORE retiring the CSV upload — the
  whole point of build-check-then-clear [[feedback_build_check_then_clear]].
- **ERA / earned runs = SOLVED + VALIDATED.** DRS SCORE-DRIVEN ER attribution (`scripts/drs/accrue_pitcher_er.py` → walks the
  pitch-to-pitch score DELTA, catches every run incl. the ~900 the per-play col drops (99.96% vs Master R), earned/unearned via
  `(UR)` tags + base-slot responsibility). A/B vs OFFICIAL Master ERA (n=3,878, IP>10): **corr 0.987, MAD 0.29, bias +0.05, 82%
  within 0.50, league means 6.54 vs 6.49.** ⇒ conf ERA off DRS earned runs is reliable; no Master-ERA dependency.
- **`batting_team_id`/`pitching_team_id` CORRUPT** (1 id → 15 teams) — use CLEAN `team_id`/`opponent_id` (this is what maps to conference).
- **TEAM STATS are stored NOWHERE** (only team_war_snapshots + Teams Table + build tables). Conf run stores PER-PLAYER intra-conf
  stats (filterable on Season Stats view) → pooled to Conference Stats aggregate. Per-team = future-optional.
- **`is_conference_game` flag → add to pitch_log** (ingest-derive + backfill, like `park_code`) so the intra-conf filter is a trivial `where` forever.
- **5 scattered producers** (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages,
  conferenceStuffPlus V1) get RETIRED after the unified run is verified. Admin edits = override; edge fn absorbs compute.

### BUILD PATH (build-check-then-clear)
add is_conference_game → per-player intra-conf rates (DRS ERA) stored + on Season Stats + A/B → pool to Conference Stats +
env+ + wRC+ → Bucket B reproduce (OPR/Stuff+/scouting/run_env/HTP total-season) → assemble ONE pass → fold into edge fn → retire producers LAST.
## ★★ BIG-WRITE MECHANICS v2 (2026-08-18) — DIRECT connection + raised statement_timeout beats ctid-batching
**The fast, reliable way to run a big single-statement write (e.g. a 2.6M-row UPDATE) — ~2-3 min, NOT an hour of batches.**
- **The two caps:** (1) the **session POOLER** (`aws-*.pooler.supabase.com:5432`, user `postgres.<project>`) hard-cancels any
  statement >~120s (57014) and IGNORES a connection-option `statement_timeout=0`. (2) The **postgres ROLE itself** also defaults
  to a **2-min `statement_timeout`** — so even the DIRECT connection cancels a long statement by default. Both must be handled.
- **DIRECT connection** = `postgresql://postgres:<DB_PASSWORD>@db.<project>.supabase.co:5432/postgres` (DB_PASSWORD = the reset
  password Trevor gave; the direct `postgres` user honors it). This connection BYPASSES the pooler cap AND honors a server-side
  `statement_timeout` (unlike the pooler, which ignores it).
- **RECIPE (one big write, fast):**
  1. `alter role postgres set statement_timeout = '600000';`  (10 min — applies to NEW sessions; `supabase db query` opens a
     fresh connection each call, so the next call picks it up). Verify with a fresh `show statement_timeout;` → `10min`.
  2. Run the ONE big `UPDATE …` via the DIRECT url. (It exceeds the 120s BASH timeout → moves to background, but the DB statement
     keeps running to completion; wait for the task-completion notification.)
  3. **RESTORE:** `alter role postgres set statement_timeout = '2min';` (put it back — the raise is global for new sessions).
  4. Recreate any index dropped for HOT; verify row counts.
- **When to use this vs ctid-batching:** prefer THIS for any big single-statement write (much faster, one statement, atomic).
  ctid-batching (drop index → CTAS → slice the SMALL driving table by ctid) remains the fallback if the direct connection is
  unavailable. TS keyset REST upserts stay timeout-immune for row-by-row compute-then-write. [[feedback_claude_runs_backfills_dry_run]]
- **PROVEN:** is_conference_game backfill (2.6M rows) — ctid-batching at 8000 blocks failed ~30% (each batch ~90-120s); the
  DIRECT+raised-timeout single UPDATE ran it in ~2-3 min. (Staging: raising the role timeout globally is fine temporarily; RESTORE after.)
## ★★★ CONFERENCE-STATS CALCULATION SPEC (#4) — COMPLETE + VALIDATED (2026-08-18) — THIS IS AN EDGE-FUNCTION STAGE
Every `Conference Stats` field, how it's computed, its source, and its validation. **All of this = ONE STAGE in the ONE edge
function (Track B):** on pitch-log ingest → recompute every conf field → store in `Conference Stats`. Retires the 5 scattered
producers (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages, conferenceStuffPlus-V1) via
build-check-then-clear [[feedback_build_check_then_clear]]. NO scattered scripts, NO live compute [[project_stored_derived_values_architecture]].

### 0. `is_conference_game` (pitch_log flag) — enables the conf-vs-conf split
= `conference_of(team_id) == conference_of(opponent_id)` (Teams Table Season 2026 source_id→conference_id; team_id/opponent_id
are the CLEAN ids — batting_team_id/pitching_team_id are CORRUPT). Backfilled (2.58M: 1.41M intra / 1.17M non; unmapped→false).
On ingest, the edge fn computes it (needs the Teams Table lookup — a post-row stage, like park_code).

### 1. HITTING RATES = INTRA-CONFERENCE only (`where is_conference_game`), pooled per conference by PROPER denominator
Aggregate terminal PAs (`pitch_result_category not in Ball/Strike/Foul`) in intra-conf games, grouped by conference (team_id→conf):
- **AVG** = ΣH/ΣAB · **OBP** = Σ(H+BB+HBP)/Σ(AB+BB+HBP+SF) · **ISO** = Σ(2B+2·3B+3·HR)/ΣAB · **SLG** = AVG+ISO (≡TB/AB).
  H=1B+2B+3B+HR; AB=H+GroundOut+FlyOut+PopOut+LineOut+Strikeout+FieldersChoice+DoublePlay+Error. VALIDATED corr 0.979/0.986/0.991, MAD ~.002.
- **env+** (ba_plus/obp_plus/slg_plus/iso_plus) = rate ÷ season NCAA (ncaa_averages: avg .2777/obp .3823/iso .1588) × 100. VALIDATED corr 0.98, MAD ~1pt.
- **wRC+** = **C1** `(0.011 + 0.691·OBP + 0.235·SLG)/0.3782 × 100` (current canonical, OBP/SLG version; AVG/ISO coeffs=0). Stored
  WRC_plus is STALE (last write 2026-06-16, pre-C1-2026-08-11) → the run CORRECTS it (don't reproduce the stale value).

### 2. PITCHING RATES = INTRA-CONFERENCE (same aggregation; in intra-conf games events ARE the conf's pitching-vs-its-hitting)
IP = outs/3; outs = (Strikeout+GroundOut+FlyOut+PopOut+LineOut+Sac+FieldersChoice) + 2·DoublePlay.
- **K9**=K·9/IP · **BB9**=BB·9/IP · **HR9**=HR·9/IP · **WHIP**=(BB+H)/IP. VALIDATED corr 0.991/0.988/0.993/0.980.
- **FIP** = `(13·HR + 3·(BB+HBP) − 2·K)/IP + cFIP`, cFIP≈**3.157** (D1 2026; near-constant, SD .056; re-derive per season = lgERA − league FIP_core). VALIDATED corr 0.986.
- **ERA** = DRS EARNED runs (intra-conf) × 9 / IP. DRS score-driven ER attribution (scripts/drs/accrue_pitcher_er.py) VALIDATED
  vs Master ERA corr 0.987; BUILD = apply that attribution filtered to is_conference_game (per-game ER → conf).

### 3. TALENT / PARK = TOTAL SEASON (all games incl. non-conf, weighted — small per-unit sample) — ALREADY BUILT
- **OPR** (Overall_Power_Rating) = PA-weighted rollup of player overall_power_rating (Hitter Master, pitch-log-derived).
- **Stuff_plus** = pitch-weighted conf Stuff+ (V2). **scouting averages** (~40 hitter_/pitcher_ scores+pcts) = PA/IP-weighted player rollups.
- **run_env_factor** = conf-avg of member-team `rg_factor` (rolling Park Factors; no handedness, 3-yr). **hitter_talent_plus (HTP)**
  = `OPR + 1.25·(Stuff+−100) + 0.75·(100 − run_env_factor)`. run_env + HTP already STORED (30 D1 confs).

### 4. STORAGE + SPLIT
Per-PLAYER intra-conf stats stored (filterable on the Season Stats view via is_conference_game) → POOLED to the Conference Stats
aggregate. Per-team = future. Keep conf-vs-conf (rates/env+/wRC+ → intra-conf) vs total-season (OPR/Stuff+/run_env/HTP) clean.
⇒ Reproduced from pitch-log at corr 0.98+ across EVERY rate field → the whole conf-stats layer sources from ONE pitch-log edge-fn stage.
## ★★★ #4 ERA VALIDATED via DRS (option B chosen) — 2026-08-18 — ALL CONF FIELDS NOW VALIDATED
**conf ERA (intra-conf) = (Σ runs − Σ runs on '(UR)' plays) / IP × 9.** Uses pitch_log `runs` (per-play) + `atbat_desc` (UR)
earned/unearned tags — the DRS engine's earned rule, done on the DB (pitch_log has atbat_desc + man_on_* + runs). A/B vs stored
ERA (n=29): **corr 0.984, MAD 0.098** (my 6.03 / stored 5.98; ~11.8% unearned = 7,022/59,386). Matches the DRS engine's 0.987.
(The `runs` col drops ~900 league-wide per the DRS doc, negligible at conf scale; score-delta refinement optional.)
⇒ **EVERY Conference Stats field validated from pitch-log at corr 0.98+:** AVG/OBP/ISO/SLG (.98) · env+ (.98) · wRC+ (canonical
C1) · K9/BB9/HR9/WHIP (.98-.99) · FIP (.986, cFIP 3.157) · **ERA (.984 DRS)** · OPR/Stuff+/run_env/HTP (total-season, built) ·
scouting (OPR-style rollup). The whole conf-stats layer sources from ONE pitch-log edge-fn stage. REMAINING #4 = ASSEMBLE the
unified run (all fields, one pass) → A/B whole → fold into edge fn → retire the 5 producers + one-off RPCs + _team_conf helper.
## ★★ #4 ASSEMBLY — Bucket A WRITTEN to staging (2026-08-18) + PLAN to finish
- **DONE:** `scripts/sql/conf_stats_unified_assembly.sql` — CTAS `_conf_agg` (per-conference intra-conf aggregate, ~20s over
  2.58M rows) → UPDATE `Conference Stats` Bucket-A fields (AVG/OBP/ISO/SLG/OPS, ba/obp/slg/iso_plus, WRC_plus=C1, K9/BB9/HR9/
  WHIP/FIP+3.157/ERA=DRS). **29 D1 confs updated.** Backup `_confstats_backup_preassembly`. Bucket B (OPR/Stuff+/run_env/HTP/
  scouting) left intact (validated + stored). Verified: refreshed values sane; WRC_plus now current-C1 (fixed the stale June value).
  NOTE (intended, not a bug): intra-conf rates put WEAK confs on top offensively (SWAC/MWC high AVG/wRC+ — hitters vs weak
  pitching) — internal balance, NOT absolute quality; exactly why HTP uses Stuff+/OPR/run_env, not wRC+, for the competition lever.
- **PLAN — remaining #4 → then PROJECTIONS:**
  1. **Per-player intra-conf storage** — store each player's intra-conf line (filterable on Season Stats via is_conference_game)
     → the conference aggregate pools from it (already = the validated `_conf_agg`). [product layer]
  2. **Scouting-averages rollup** — verify + write the ~40 hitter_/pitcher_ fields (total-season PA/IP-weighted, OPR-style).
  3. **Fold the WHOLE run into the ONE edge function** (Track B): on ingest → is_conference_game → _conf_agg → Conference Stats
     (Bucket A) + Bucket B rollups + run_env/HTP, all stored, stamped. Repoint the live-HTP display spots to read stored (page-load gate).
  4. **RETIRE the 5 producers** (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages,
     conferenceStuffPlus-V1) + one-off RPCs (flag_conf_batch, set_conf_game) + helper `_team_conf` — build-check-then-clear (last).
  5. **→ THEN PROJECTIONS (edge fn 6b):** with every lever final (Stuff+, park, HTP, conf-stats), fire the transfer recompute →
     7c snapshots (also fixes TB oWAR regression) → NIL wiring. Everything lands ONCE. (Trevor: "next is going to be the projections.")
## ★★ INDEPENDENTS / FACED-COMPETITION DESIGN (Trevor 2026-08-18) — [[project_faced_competition_independents]]
Oregon State players transferring → Independents have NO conference peers (OSU: 59 games, **0 is_conference_game**), so the
intra-conf conf-stats framework produces nothing + the "Independent" conf row is a meaningless grab-bag. Stuff+ itself is fine
(absolute D1). **SOLUTION = schedule-FACED competition** (the deferred OSU-faced-schedule concept, now proven): weighted avg of
the conferences a team actually PLAYED × the per-conference Stuff+/HTP, from pitch_log opponent_id per PA.
- Hitters → faced pitching = Σ(opp_conf.Stuff_plus × PA)/ΣPA. Pitchers → faced hitting = Σ(opp_conf.HTP × PA)/ΣPA.
- **PROVEN: OSU faced Stuff+ 100.3 / HTP 104.6** (vs D1 avg 98/99) from their Big-West-heavy multi-conf schedule.
- STORE per-team faced_stuff_plus/faced_htp (edge-fn stage). Independents → transfer engine reads FACED instead of conf row.
- GENERALIZES: faced = correct competition for everyone (who you played); conf avg = approximation (faced≈conf-avg for conf teams).
  FUTURE: per-player faced (Stuff+-faced-per-PA). BUILD-READY — offered to implement per-team faced metrics.
## ★★★ TEAM_SEASON_STATS TABLE — DESIGN (Trevor 2026-08-18) — the missing per-team-per-season stats layer
Forced by Independents (faced-competition [[project_faced_competition_independents]]); becomes the general team-stats home the
system lacks. **Comprehensive schema, POPULATE INCREMENTALLY.**

### KEYS (confirmed via investigation)
- `source_id` = **PROGRAM id, STABLE across seasons** (OSU 3111, UGA 226 — same every year). `id` = **PER-SEASON UUID** (differs
  each season). `conference_id` = stable per team unless realignment. 774 team-seasons / 466 programs.
- **Natural key = `(source_id, season)`** (like `team_builds`). STORE BOTH `source_id` (program) + `id` (per-season) + `conference_id`
  for full id consistency + joins. One row per team per season.

### CONTENTS (Trevor — store both team-faced AND conference metrics; not redundant)
- **Competition (Phase 1, Independents need NOW):** `faced_stuff_plus`, `faced_htp` (schedule-weighted from pitch_log opponent_id ×
  per-conf Stuff+/HTP) + `conference_id` + the team's conference Stuff+/HTP/run_env (baseline). Faced = exact competition PLAYED;
  conference = baseline/context. Both valuable (faced≈conf for conf teams = validation; faced is THE metric for Independents).
- **Rate line (Phase 2):** ERA/AVG/OBP/SLG/ISO/wRC+/K9/BB9/HR9/WHIP/FIP per team (the per-team version of the conf rollup — methods
  validated). Optionally intra-conf vs total splits.
- **WAR (Phase 3):** desc WAR + total WAR per team — **CONSOLIDATE `team_war_snapshots` INTO this table** (it already stores team
  WAR — do NOT duplicate → drift; migrate + repoint readers, build-check-then-clear).
- **Park (Phase 4):** per-team park factors — **REFERENCE/absorb `Park Factors`** (already per-team; don't triple-copy).
- **Future:** HOME/ROAD team splits; per-PLAYER faced (Stuff+-faced/HTP-faced per PA) — the granular ultimate [[project_faced_competition_independents]].

### DISCIPLINE (the load-bearing caution)
This table = the CANONICAL per-team-per-season home. Existing per-team stores (team_war_snapshots, Park Factors) get
CONSOLIDATED/referenced, NOT copied — else a 3rd drifting copy (the exact "built over the top" trap [[feedback_build_check_then_clear]]).
Populated by the ONE edge fn (schedule-weighted faced = a rollup of the per-conf metrics). Stored-not-live. Transfer resolver:
team → team_season_stats; Independent → use faced_*; else conference metrics (or faced as refinement). NOT too far ahead — right
target, incremental build; Phase 1 (faced + conf metrics) ships with the conf-stats edge-fn stage.
## ★★★ team_season_stats — CONSOLIDATE (one canonical table, like the Masters) — DECISION (Trevor + agent 2026-08-18)
Trevor: don't love Phase-1-only (ideas get lost) + torn on tearing down team_war_snapshots/Park Factors that work. RESOLUTION:
- **ONE consolidated `team_season_stats` table = canonical, holding EVERYTHING** (faced_stuff_plus/faced_htp, conference metrics,
  all rates ERA/AVG/OBP/SLG/ISO/wRC+/K9/BB9/HR9/WHIP/FIP, desc WAR + total WAR, park factors, later home/road). The Masters
  philosophy (one per-player table) applied to teams. Key `(source_id program-stable, season)` + store `id` (per-season) + conference_id.
- **FILL EVERY COLUMN in the FIRST pass** (not Phase-1-only) — computed in the ONE edge fn (we already have every method:
  rates validated, faced = schedule rollup, WAR computed, park = rolling). "Incremental" = only VERIFICATION order, NOT empty columns.
- **BUILD-CHECK-THEN-CLEAR retires the old tables safely (NOT a reckless teardown):** (1) build team_season_stats + populate all;
  (2) A/B the WAR columns vs `team_war_snapshots` + park columns vs `Park Factors` (must match); (3) repoint readers → retire the
  old tables. **The old tables stay LIVE + wired until their fields verify — nothing breaks in the interim** (same pattern as park/HTP/conf-stats).
- **THE DRIFT RULE:** the trap is not a new table — it's leaving TWO LIVE COPIES. Pick ONE: CONSOLIDATE (this table canonical, old
  retired after verify — CHOSEN) OR FEDERATE (old stays canonical, team_season_stats holds only homeless stats + a VIEW joins).
  Never both-live-copies. [[feedback_build_check_then_clear]] Consolidate matches the Masters + one-process goal.
## ★★★ PROD-PUSH LOGGING DISCIPLINE — VITALLY IMPORTANT (Trevor 2026-08-19)
EVERY schema or SQL change goes into `PROD_MIGRATIONS_TODO.md` the moment it runs on staging — no exceptions. That file is
the SINGLE authoritative record the staging→prod push reads; if a DB change isn't written there, it does NOT happen on prod
(= a bug). Log: CREATE/ALTER (cols/types/constraints/indexes), any DROP (incl temp/helper cleanup), backfills/recomputes/UPDATEs,
RLS enables/policies, role/GUC changes, new RPCs/views. Each entry: exact DDL/SQL + `APPLIED STAGING <date>` vs `PROD pending` +
prod-specific note (esp. "regenerate from PROD data, don't copy staging" for per-env values). team_season_stats is logged there
(CREATE + every ADD COLUMN + the team_war_snapshots/Park Factors consolidation DROPs, each line as applied). See the banner at
the top of PROD_MIGRATIONS_TODO.md.
## ★ PARK FACTORS — KEEP the table (do NOT retire); team_season_stats FEDERATES it (Trevor 2026-08-19)
Refines the "consolidate into team_season_stats" plan. Two different fates by GRAIN:
- `team_war_snapshots` = SAME grain (team×season) → team_season_stats SUBSUMES it (data → columns, retire after A/B verify).
- `"Park Factors"` = DIFFERENT grain — a park-data INPUT store (raw single-season + rolling, ALL history, keyed by park/team-season),
  an ingredient projections consume, not a per-team summary. **KEEP IT.** Always need the historical park record + we are NOT
  backfilling full park history into team rows. So park is FEDERATED, not consolidated.
team_season_stats stores the park values USED for that team-season = a DERIVED SNAPSHOT: the **3-yr rolling** (the number that
feeds projections) + the **single-season**, both stamped by the edge fn from `"Park Factors"` each run. NOT a drift copy — single
writer (edge fn) recomputes from the source-of-truth `"Park Factors"` every run; the team row just carries the value that applied
so reads are self-contained (stored-not-live). RULE: team_season_stats SUBSUMES same-grain per-team-season tables, FEDERATES
different-grain input stores (Park Factors, and by the same logic any raw historical input store). [[project_park_factor_rework]] [[feedback_build_check_then_clear]]
## ★★★ team_season_stats — AUTHORITATIVE SCHEMA + BUILD RULE (Trevor-confirmed 2026-08-19)
The comprehensive per-team-per-season table, written AUTOMATICALLY by the ONE edge fn (read surface; edge fn = the writer).
BUILD RULE: team = **Σ player values**. Sum every counting stat (per window), then DERIVE weighted rates from the sums
(PA/IP weight falls out — never average player rates). Team WAR = Σ player WAR (per window). Records/park/conf/faced from their sources.

**KEYS:** source_id (program, STABLE) + team_season_id (per-season Teams Table id, uuid) + season + conference_id + team_name/abbreviation.

**WINDOWS:** WARs are stored TWICE — `_reg` (regular season) + `_total` (incl. postseason), split on the season boundary
(reg ends 2026-05-18, [[project_season_boundaries]]). Counting stats also stored both windows (cheap → rates derivable either). Rates DERIVED, not split-mandated.

**COLUMNS:**
- Records (NEW run from pitch_log game outcomes — NOT a player rollup): w/l overall, w/l conference (+ total incl post). FUTURE: wins_over_projection (actual vs projected-from-team-WAR).
- Hitting counting (Σ players): pa/ab/h/2b/3b/hr/bb/hbp/k/sb/cs/sf… → DERIVED avg/obp/slg/iso/ops/wrc+ (from sums).
- Pitching counting (Σ players): ip(=outs/3)/k/bb/hbp/hr/h/er… → DERIVED era/fip/whip/k9/bb9/hr9 (from sums).
- WAR matrix (Σ player WAR), each _reg + _total: owar, dwar, bsrwar, pwar, total_war. (bsrwar → "best baserunning team in the country" leaderboard.)
  Carry from team_war_snapshots: proration_factor, games_played_est, n_hitters, n_pitchers, team_drs, is_national_champ, is_conference_champ, national_seed_rank.
- Conference-scoped (intra-conf, MIGRATE from "Conference Stats"): conf rate line + conf_stuff_plus, conf_htp, run_env_factor.
- Competition (faced): faced_stuff_plus, faced_htp.
- Park (federated SNAPSHOT of values USED — Park Factors stays the historical source): park_single_season (current) + park_rolling_3yr (projection input), per component.
- FUTURE: home/road splits, per-player faced.

**team_war_snapshots = MIGRATE, don't scrub** (staging: 2026 only, 308 rows; prod: +2025 champion seed). season is a key → every
existing row becomes a team_season_stats row (WAR A/B-verified, champion flags/seed/proration carried), THEN retire the old table.
## ★ team_season_stats — DB FINDINGS (probe 2026-08-19) → dedicated handoff docs/HANDOFF_team_season_stats_2026_08_19.md
1. **WAR reg/total split ALREADY exists per player** → the team WAR rollup is a PURE `SUM ... GROUP BY (TeamID, Season)`, no
   player-boundary work. Hitter Master: desc_owar/d_war/bsr_war/total_desc_war (+ _reg) + regular_season_pa/pa/ab. Pitching
   Master: desc_pwar/total_desc_war/desc_ra9/desc_fip_ra9/drs_behind (+ _reg) + regular_season_ip/IP. team WAR = Σ these.
2. **team_war_snapshots — MIGRATE not scrub.** Staging = 2026 only (308). PROD = 2025 (309, incl LSU natl champ + 39 conf champs)
   + 2026 (466). 2025 championship history lives ONLY on prod → prod migration must read prod's own table; carry champion flags/
   seed_rank/proration into team_season_stats rows, verify, then DROP.
3. **Counting stats + rates come from pitch_log** (reuse conf-stats machinery), NOT the Masters (Masters store rates, not raw
   counts, beyond pa/ab). Build rule = sum counts (pitch_log) → derive rates; sum WAR (Masters). Records = NEW pitch_log
   game-outcome run (runs/game→W/L; is_conference_game→conf record) → enables wins-over-projection.
4. ⚠ JOIN KEY to confirm at build: Masters `TeamID` + `Season` → "Teams Table" (id per-season vs source_id) → source_id + conference_id.
Full execution order (0–7) + verify plan in the dedicated handoff.
## ★ team_season_stats — BUILD PROGRESS + DECISIONS (2026-08-19, staging)
STEP 1 DONE: CREATE TABLE team_season_stats (117 cols) + RLS, staging. Migration supabase/migrations/20260819000000_team_season_stats.sql.
STEP 2 DONE: WAR rollup (Σ Masters, reg+total), D1 ONLY. 308 rows. VERIFIED: pWAR corr 1.0000 / max diff 0.005 vs
team_war_snapshots.raw_total_pwar (exact); oWAR = Σ desc_owar correct by construction (Arkansas 16 hitters, 0 null, Σ=8.86).
SQL: scripts/sql/team_season_stats_war_rollup.sql.

DECISIONS (Trevor 2026-08-19):
- **D1 ONLY** — JUCO (NJCAA_D1, 158 teams) EXCLUDED. Descriptive WAR is D1 (all 5343 D1 hitters have desc_owar; all 2903 JUCO NULL).
  JUCO runs on the projection overlay elsewhere. (Aligns with the Division Table Separation direction.)
- **DESCRIPTIVE ONLY — no projection WAR block.** Projection is a TEAM BUILDER function living in a DIFFERENT area; we have NO
  historical projections. 2027 is the FIRST time we store preseason projections + a LIVE desc WAR accumulating through the season
  (+ per-play). team_season_stats holds 2026 descriptive now; 2027 desc WAR folds in from the pitch log (not projection) as the season builds.
- **ONE future column added:** preseason_proj_total_war (nullable, per program) — for tracking players/programs vs preseason
  expectation; populated starting 2027 preseason. Per-PLAYER preseason projection lives elsewhere/future. NOT a blocker to this build.
- **team_war_snapshots migration = historical/champion carry ONLY** (2025 champs, seed). Its old oWAR is the pre-redesign PROJECTION
  metric — NOT a baseline for the new descriptive oWAR (it validated pWAR only). Do NOT overwrite descriptive with it.
- Dropped scratch _conf_agg (29) + _team_home_park (368) — completed-step intermediates; results already in Conference Stats / Park
  Factors; backups exist. Cleared the staging RLS advisory.
## ★★★ team_season_stats STEP 3 — RATE/COUNTING SOURCE = the authoritative MASTERS, not pitch_log (Trevor 2026-08-19)
THE QUESTION (Trevor): can team counting/rates be an aggregate of the roster's Master stats instead of pitch_log? His criterion:
"unless the Master columns were read from the pitch log and totaled … if not, the process needs to work properly in the edge function."
FINDING (scripts/import-csvs/registry.ts): Hitter Master = "Full-replace season snapshot of D1 hitter stats (TruMedia export
includes PA/AB)" — AVG/OBP/SLG/PA/AB are the TruMedia AUTHORITATIVE season export (= Baseball Reference), NOT summed from pitch_log.
Pitch_log is a SEPARATE engine with its own quantile-mapped rates (src/savant/lib/pitchLogRates.ts) that deliberately differ +
has known dedup gaps. Memory: "⚠ Master AUTHORITATIVE (=BBRef); pitch log = engine/cross-check."
DECISION: **team rate block = weighted aggregate of the authoritative MASTERS** (NOT pitch_log — the pitch-log-totaled criterion is
NOT met, so per Trevor's own logic we use the Master). EDGE-FN FIT: on upload the TruMedia CSV import (import-csvs, part of the
pipeline) populates the Masters → edge fn aggregates them into team_season_stats. Works in the one-process model.
METHOD (= "sum first, then rate"; weighting IS the summing):
- Hitting (total season): team AVG = Σ(AVG·ab)/Σab ; team OBP = Σ(OBP·pa)/Σpa ; team SLG = Σ(SLG·ab)/Σab ;
  team ISO = teamSLG−teamAVG ; team OPS = teamOBP+teamSLG ; team wRC+ = C1(teamOBP,teamSLG). Store pa_total, ab_total (authoritative Σ).
- Pitching (total season): team ERA/FIP/WHIP/K9/BB9/HR9 = Σ(rate·IP)/ΣIP (IP-weighted = ΣER/ΣIP·9 etc.). Store ip_total, bf_total.
- D1 only; ab>0 / ip>0 filter.
CAVEATS: (a) Master has TOTAL-season rates only (no reg-season rate columns; it has regular_season_pa/ip) → REG rates deferred
(Trevor: rates don't need both windows; WAR does). (b) Master lacks individual counting splits (HR/2B/3B/BB/HBP/SB/CS/SF) → those
come from pitch_log in a later pass or are skipped for v1; store the authoritative Σpa/ab/ip/bf now.
## team_season_stats STEP 3 DONE (rates, staging 2026-08-19)
Both UPDATEs 308 teams, 0 null. Team AVG/OBP/SLG = .277/.381/.434 (= D1 NCAA baselines .2777/.3823/.4365), wRC+ avg ~99-100 (center),
ERA 3.22–10.90 avg 6.16, FIP avg 5.03. Spot-check: Georgia .318/.612/wRC+120 (elite offense), Arkansas ERA 4.74 / Tennessee 4.72
(top pitching, below D1 avg), IP 497–573 (~55-game season). Authoritative-Master aggregation VALIDATED. Total-season only; reg rates
+ detailed counting splits (HR/2B/3B/BB/HBP/SB/CS/SF, from pitch_log) deferred to a later pass. SQL scripts/sql/team_season_stats_rates.sql.
## team_season_stats STEP 4 DONE (records, staging 2026-08-19)
Records from pitch_log game outcomes. GAME KEY = DISTINCT (team_id, date, game_venue_id, total_runs, opponent_runs) — total_runs is
the game FINAL (constant per game; the 940 multi-final groups = real doubleheaders, ~3/team, split correctly on the score pair). W/L
from total_runs vs opponent_runs; 14 ties (suspended/incomplete) excluded. team_id = source_id (joins team_season_stats directly).
Boundary 2026-05-18: w_total/l_total=all, w_reg/l_reg=reg, w_conf/l_conf=REG-SEASON conference (standings — postseason/SEC-tourney
excluded). VERIFIED: 308 teams avg 55.0 games (min 37/max 71); Georgia 53-14 (23-7 SEC = 30 conf games ✓), Arkansas 41-22 (17-13 ✓).
⚠ FINDING: game_string + park_code are 0% populated on staging pitch_log (0/2.58M) — the park_code ingest backfill is STILL PENDING
(prod runbook §pitch_log_park_code). When backfilled, records could key on game_string (has game#) instead of the score-pair heuristic.
Enables wins-over-projection (future). SQL scripts/sql/team_season_stats_records.sql.
## team_season_stats STEP 5 DONE (migrate snapshot + conf context, staging 2026-08-19)
(a) Snapshot carry (308): proration_factor/games_played_est/is_national_champ/is_conference_champ/national_seed_rank from
team_war_snapshots (source_team_id=source_id). NOT the old oWAR (stale pre-redesign projection metric). ⚠ team_drs NULL — source
empty on staging (snapshot rebuilt post 2026-08-09 populate); dwar_total (the WAR) already populated; regenerate team_drs via
scripts/drs/derive_team_drs.mjs if needed. PROD: run against PROD team_war_snapshots → carries 2025 champions (LSU + 39 conf champs).
(b) Conf context (308): conf_stuff_plus/conf_htp/run_env_factor/conf_opr/conf_wrc_plus from "Conference Stats" via conference_id.
VERIFIED: 30 distinct conferences; SEC (Georgia) conf Stuff+ 105.2 / HTP 130.3 vs Ivy (Penn) 98.4 / 95.5 — correct ranking (SEC top).
SQL scripts/sql/team_season_stats_migrate_snapshot_conf.sql (2 UPDATEs, run separately).
## team_season_stats STEP 6 DONE (faced + park, staging 2026-08-19) — TABLE FULLY POPULATED
FACED semantics VALIDATED: pitch_log team_id = pitching/defense side, opponent_id = batting side (batter belongs to opponent_id ~84%
of rows). faced_stuff_plus(T) = pitch-weighted conf Stuff+ of the pitchers T's HITTERS faced (rows opponent_id=T, metric = team_id's
conf Stuff+). faced_htp(T) = pitch-weighted conf HTP of the hitters T's PITCHERS faced (rows team_id=T, metric = opponent_id's conf HTP).
Reproduces the proven Oregon State faced Stuff+ 100.2 (proof 100.3) / HTP 104.5 (proof 104.6) — method confirmed. 308/308.
PARK snapshot: rolling (rg/avg/hr9_factor) + single-season (_seasonal) from "Park Factors" (source_team_id=source_id); Park Factors
STAYS the historical source (federated). 308/308.
★ team_season_stats is now FULLY POPULATED for 308 D1 teams: keys, WAR matrix (reg+total), rates, records, snapshot/champion carry,
conf context, faced competition, park snapshot. Remaining: step 7 = fold into the ONE edge fn + repoint readers + retire team_war_snapshots.
SQL scripts/sql/team_season_stats_faced_park.sql.
## ★★★ team_season_stats — RATE SOURCE re-decision + park_code reality (Trevor 2026-08-19)
### RATE/COUNTING SOURCE → pitch_log (frequent primary), TruMedia Master = cross-check/confirm (Trevor's operational model)
- pitch_log_hitter_totals + pitch_log_pitcher_totals EXIST (per-player, keyed batter_id/pitcher_id + season + dimension_key; 'all'
  = full season, 6099 hitters / 37306 pitcher-dims). Hitter totals carry RAW COUNTS: pa, ab, hits_single/double/triple/hr, k, bb,
  hbp, sac (+ batted-ball detail, x_hits/x_bases/x_woba). BETTER than the Master (which stores rates + pa/ab only, no HR/2B/3B/BB splits).
- CROSS-CHECK (pitch-log team rates vs the Master-derived rates I stored in step 3): corr AVG 0.9957 / SLG 0.9974; MAD AVG .0012 /
  OBP .0039 / SLG .0021; pitch_log has ~16 FEWER AB/team (<1%, the dedup/missing-games gap). ⇒ Near-identical; the ~16 AB gap is
  exactly where TruMedia "confirms + corrects."
- DECISION: **rebuild the rate+counting block from pitch_log_*_totals** (matches the edge-fn cadence — pitch log is the FREQUENT feed,
  TruMedia is SPORADIC cross-check) + gains the counting splits (hr/2b/3b/bb/hbp). Keep the Master A/B as the standing cross-check.
  Step 3 currently = Master-sourced (interim, authoritative, within .001) — to be re-sourced from pitch_log in the wiring step.
  ⚠ WRINKLE: pitch_log_pitcher_totals lacks IP/ER → team ERA/FIP need the IP(=outs/3)/earned-run derivation (conf-stats ERA-via-DRS
  machinery); hitting rebuilds cleanly. WAR (step 2) is ALREADY pitch-log-native (desc_* computed from pitch_log) — no change.

### park_code / game_string — NEVER backfilled (Trevor thought it was done)
0 of 2,579,655 rows (2026; pitch_log is 2026-only) have park_code OR game_string. We added the INGEST logic (ingest_pitch_log.ts) +
validated park factors via clean team_id home/away (corr 0.996) — but the BACKFILL of park_code/game_string onto existing rows was
never run. Still the pending follow-on (prod runbook §pitch_log_park_code). Records (step 4) key on the score-pair fallback because of this.
## ★★★ EDGE-FN DATA-PATH AUDIT (Explore agent, 2026-08-19) — every piece → path clear
### THE EDGE FN = PROJECTION ENGINE, NOT descriptive
supabase/functions/process-precompute-jobs/index.ts is the ONLY edge fn (no separate unified-projection fn yet). It writes ONLY
player/build level: player_predictions (hitter: from_*/p_avg/p_obp/p_slg/p_ops/p_iso/p_wrc/p_wrc_plus/o_war/market/twp_market/
projected_pa/hitter_depth_role; pitcher: p_era/p_fip/p_whip/p_k9/p_bb9/p_hr9/p_rv_plus/p_war/market/projected_ip/roles),
team_build_players (player_snapshot JSON), team_builds, gm_budget, gm_activity, precompute_jobs. RPCs: propagate_*_scores_to_predictions,
refresh_composite_war. It does NOT write team_war_snapshots or team_season_stats. ⇒ team_season_stats is a NEW DESCRIPTIVE stage,
separate from the projection edge fn. Its pipeline: pitch_log ingest → pitch_log_*_totals (aggregate_pitch_log_dimensions.ts) →
Masters desc_* → team_season_stats. (Part of the Track B unified on-upload pipeline goal; distinct from the projection path.)

### MASTER RATES = pure TruMedia CSV (confirmed), never pitch-log, never overwritten
import-csvs/registry.ts + runner.ts: Hitter/Pitching Master AVG/OBP/SLG/ISO/ERA/FIP/WHIP/K9/BB9/HR9 = TruMedia full-replace import.
Only non-CSV writes to Masters = stuff_plus, Role, Overall Stuff+ (NOT rates). ⇒ confirms pitch_log=frequent, TruMedia=cross-check.

### PITCH-LOG PER-PLAYER STATS (the frequent rate path)
pitch_log_hitter_totals / pitch_log_pitcher_totals — RAW COUNTS, written by scripts/aggregate_pitch_log_dimensions.ts, keyed
(batter_id|pitcher_id = source_player_id, season, dimension_key; 'all'=full season). Hitter has pa/ab/hits_single/double/triple/hr/
k/bb/hbp/sac (+ battedball detail). Pitcher has total_bf/pa/ab/k/bb/hbp/hits_*_allowed (⚠ NO IP/ER → team ERA/FIP need IP=outs/3 +
earned-run derivation; Pitching Master has desc_ra9/desc_fip_ra9 as the pitch-log-native pitching rate already). App hooks already
convert counts→rates (usePitchLog2026HitterRates/PitcherRates, usePitchLogTotals).

### TEAM-AGGREGATE READERS TO REPOINT (only 4 files, all via team_war_snapshots)
src/hooks/useTeamWarSnapshots.ts (useTeamWarSnapshot L63/90/107, useWarBenchmarks L129/134, useNationalSeedBenchmark L161/167,
useAllTeamSnapshots L211/216); src/gm/pages/GMAnalytics.tsx (L77/78); src/pages/team-builder/tabs/AnalyticsTab.tsx = the Compare
tab (L46/47); types.ts:2499. Nothing reads team_season_stats yet. Script writers to retire: seed_team_war_snapshots_*.sql, team_drs_store.sql.

### park_code backfill = NEVER RUN (confirmed by agent)
Migration adds columns only; no UPDATE exists anywhere; only ingest_pitch_log.ts:319-320 writes them on NEW rows. Park factors derive
from game_venue_id, not park_code. 0/2.58M populated.

### WIRE/CLEAR PLAN
WIRE: (1) re-source rate/counting block from pitch_log_*_totals (hitting clean + splits; pitching needs IP/ER — decision pending on
2026: keep Master-final+add-splits vs switch fully to pitch-log). (2) assemble the 6 populate steps into ONE ordered team_season_stats
refresh routine (the descriptive stage). (3) repoint the 4 reader files to team_season_stats (build-check-then-clear + page-load gate).
CLEAR (after verify): retire team_war_snapshots + seed_team_war_snapshots_*.sql + team_drs_store.sql.
OPEN DECISION: 2026 rate source (Master-final+splits vs full pitch-log). Lean: keep Master-final for 2026 + add splits; pitch_log
primary for live 2027+, TruMedia reconcile.
## team_season_stats — RATE/COUNTING RE-SOURCED pitch-log-primary (staging 2026-08-19)
Trevor's operational model LOCKED: pitch log = LIVE/frequent (daily through spring); TruMedia Master = OCCASIONAL source-of-truth
fill (gaps + low-TrackMan programs not in pitch log; weekly/monthly, valid source of truth). ⇒ stored rates = pitch-log-derived,
Master reconciles/fills where thin/absent. ALSO: it's ONE edge fn — upload → collect/derive/store ALL data (Masters, pitch_log_*_totals,
team_season_stats) → run returner + transfer projections (projections depend on the stored data). team_season_stats = a STORE stage IN
that one fn, not a separate pipeline.
DONE: HITTING fully pitch-log (pitch_log_hitter_totals dim 'all' → rates + counting splits hr/2b/3b/bb/hbp/k). 308/308, corr 0.996 vs
Master, Georgia .324/.623 175HR wRC+121 (team avg unchanged .277/.434). PITCHING counting pitch-log-native (pk/pbb/phbp/phr/ph/bf);
pitch-log K9 vs Master K9 corr 0.998; Arkansas 631K/213BB/90HR. Supersedes step-3 Master-sourced hitting. SQL scripts/sql/team_season_stats_rates_pitchlog.sql.
FOLLOW-ON: full pitch-log PITCHING rates (ERA/FIP via IP=outs/3 + ER derivation — conf-stats machinery); Master-reconcile/fill logic (COALESCE, no-op for 2026 D1).
## ★ team_season_stats WIRE B DONE — ONE idempotent routine (staging 2026-08-19)
refresh_team_season_stats(p_season int, p_reg_end date DEFAULT <season>-05-18) — plpgsql fn, migration
20260819010000_refresh_team_season_stats.sql. DELETE season → rebuild via 10 sub-steps (base+WAR Σ Masters; hitting rates+counting
splits from pitch_log_hitter_totals; pitching counting from pitch_log_pitcher_totals; pitching rates Master IP-weighted; records from
pitch_log; snapshot carry; conf context; faced_stuff_plus/faced_htp; park snapshot). Idempotent + season-parameterized. This is the
descriptive STORE STAGE the unified upload edge fn calls (RPC) after Masters + pitch_log_*_totals refresh, before/around projections.
VALIDATED: select refresh_team_season_stats(2026) → 308 rows; reproduces EVERY verified number (pWAR corr 1.0000, team .277/.434,
Georgia 53-14 (23-7), OSU faced 100.2/104.5, 308 fully populated). NEXT: WIRE C repoint the 4 readers (useTeamWarSnapshots/GMAnalytics/
AnalyticsTab/types) to team_season_stats + page-load gate; then CLEAR retire team_war_snapshots + seed scripts (build-check-then-clear).
## ★ team_season_stats CONSOLIDATION COLUMNS (Trevor decisions 2026-08-19) — replaces team_war_snapshots' comparison structure
Compare card (TB Analytics + GM Analytics) = prior-season DESCRIPTIVE team WAR vs current-build PROJECTED roster WAR, side by side.
4 cells refreshed to DESC WAR, REGULAR-SEASON basis (NO proration — Trevor: reg-season total more accurate than the old 56-game prorate):
- **Hitter WAR = full team o+d+bsr** (hitter_war_reg = Σ hitter total_desc_war). REPLACES the old "Lineup oWAR (top-9)" cell. ⚠ Coordinated
  frontend change: the current-build side (GMAnalytics.tsx:65 gm.hitters.slice(0,9) oWAR; AnalyticsTab buildLineupOwar) must switch from
  top-9 oWAR → all-hitters o+d+bsr, and the label "Lineup oWAR" → "Hitter WAR". Nothing removed — the cell just measures full hitter value.
- **Rotation pWAR** (rotation_pwar_reg) + **Bullpen pWAR** (bullpen_pwar_reg) — KEPT (Trevor). rotation = top-3 pitchers by IP, bullpen = rank 4+.
- **Total WAR** (total_war_reg = hitter+rotation+bullpen).
Columns added: hitter_war_reg/total, rotation_pwar_reg/total, bullpen_pwar_reg/total. Folded into refresh_team_season_stats() (step 1 +1b).
VALIDATED: rotation+bullpen=pwar (0 mismatch), hitter_war=o+d+bsr (0 mismatch); Georgia 24.0hit/7.0rot/6.1bp/37.1tot, Arkansas 10.8/5.9/7.3.
TOP-9 USAGE (answer to Trevor): the top-9 lineup oWAR is 1 of 4 comparison cells in TB Analytics (Year-over-Year + Championship Benchmark +
National Seed Range) AND GM Analytics — current-build side computes it live (slice(0,9)), prior-year side reads the snapshot. Switching to
full-team hitter WAR changes BOTH sides + the label; it's a deliberate swap, not a break.
NEXT (WIRE C frontend): repoint useTeamWarSnapshots.ts + GMAnalytics.tsx + AnalyticsTab.tsx + types.ts to team_season_stats (_reg cells);
change current-build hitter calc top-9→full-team o+d+bsr; relabel; page-load verify. Then CLEAR retire team_war_snapshots + seed_team_war_snapshots_*.
## ★★★ team_season_stats — RETIRE + HITTER-WAR decisions (Trevor 2026-08-19)
### DO NOT RETIRE team_war_snapshots — FEDERATE BY ERA
team_season_stats is descriptive-FROM-pitch_log, and pitch_log is 2026-ONLY (no 2025 pitch_log → 2025 descriptive WAR is
IMPOSSIBLE to compute). Prod's team_war_snapshots 2025 rows (LSU natl champ + 39 conf champs + the prior-year WAR the current 2026
build compares to) are the ONLY source of 2025 team WAR and CANNOT be regenerated. ⇒ KEEP team_war_snapshots as the pre-pitch-log
HISTORICAL store; team_season_stats = canonical for 2026+ (seasons with pitch_log). Readers: team_season_stats for 2026+, fall back
to team_war_snapshots for 2025. Same federate-by-era principle as keeping "Park Factors". **The "CLEAR/retire team_war_snapshots"
step is REMOVED** — no data loss, 2025 is frozen. (Step 5 still CARRIES champion flags/seed into team_season_stats 2026 rows for teams present.)

### HITTER WAR — PIVOT everywhere: "Starting Lineup oWAR" (top-9) → "Full-team desc Hitter WAR" (o+d+bsr, ALL hitters)
Trevor: total hitter war (o+d+bsr) not just oWAR, full team (whole roster) not top-9, for consistency. REPLACE, not keep-both.
- Prior-season side = team_season_stats.hitter_war_reg (= Σ hitter total_desc_war = o+d+bsr — already built).
- Current-build side = projected FULL-TEAM hitter WAR (all hitters' projected o+d+bsr) — REPLACES GMAnalytics.tsx:65 gm.hitters.slice(0,9)
  oWAR + AnalyticsTab buildLineupOwar/starterTotalOwar. Relabel "Starting Lineup oWAR"/"Lineup oWAR"/"Δ Lineup" → "Hitter WAR".
- Comparison = full-team desc hitter WAR (prior) vs projected full-team hitter WAR (current). NO starting_lineup_owar column needed (hitter_war is it).
- Hero strip (AnalyticsTab:827-838) headline pivots to full-team hitter WAR; the position-tier lineup display below (:840-857) stays (current-build starters by position).
FRONTEND (WIRE C, page-load gated): useTeamWarSnapshots.ts (add team_season_stats source, era fallback) + GMAnalytics.tsx (hitter calc + labels)
+ AnalyticsTab.tsx (starterTotalOwar/buildLineupOwar → full-team hitter WAR + labels) + types.ts. Reg-season desc basis, no proration.