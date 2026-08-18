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