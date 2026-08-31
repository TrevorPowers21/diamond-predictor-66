> 🚨 **BEFORE ACTING ON ANYTHING IN THIS FILE:**
> · **`docs/HANDOFF_WHATS_AHEAD_2026_08_31.md`** — what is ahead, the 6 Track B blockers, and the 11 earned rules
> · **`docs/HANDOFF_2026_08_31_EOD.md`** — current prod state, verified in the DB
> · **"🚨🚨 SILENT-FAILURE REGISTRY"** (below in this file) — 16 defects that produced a populated table, a clean
>   exit code and a plausible number. **NOT ONE raised an error.** Each entry says where it belongs in Track B.
> **A stage that "ran fine" tells you nothing.**

# AGENT LEARNINGS — Stuff+ (2026-08-16)
> ## ★ CURRENT STATE — READ FIRST (2026-08-30). This supersedes every older statement in this file.
> - **LANE (TOP DOG):** the only correct Stuff+ lane is the **pitch_log lane** —
>   `pitch_log.pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus` →
>   `aggregate_pitch_log_dimensions.ts` → `pitch_log_pitcher_totals` / `_by_pitch_type` → Season Stats + PitcherProfile.
>   **armHB throughout, self-consistent, CORRECT.**
> - **LEGACY LANE (≤2025 + JUCO ONLY, NEVER 2026):** `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
>   `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. It stores RAW hb, and since commit `e5dec2f` the
>   shared equations expect armHB — so running it scores **LEFT-HANDERS BACKWARDS**. Not live, not on main. Every step in
>   this document has been rewritten onto the pitch_log lane; if you find one that still routes through the legacy lane,
>   it is WRONG. (`legacy_breakingBallReclassification.ts`, renamed from `breakingBallReclassification.ts`, never touched
>   `pitch_log` and is NOT the anchor classifier.)
> - **CLASSIFIER:** `src/savant/lib/stuffPlusClassifierV2.ts` is the SINGLE source (`scripts/reclassify_v2.ts` is only a
>   validation harness; its duplicate copy was deleted). **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix /
>   needs_review 8.1%** on the full 2,000,674-pitch population. ⚠ SUPERSEDED — never quote as current: **92.6%, 94.3%,
>   95.1%, "~85%", and any "projected ~95.3-95.4%"**.
> - **DECISION (Trevor, FINAL):** standardize on v2 in **BOTH** environments — **DO overwrite staging's labels.** Any
>   "do NOT overwrite staging's labels" guidance anywhere is REVERSED and obsolete.
> - **STAGING:** the v2 chain is RUN + VERIFIED — backup `_v2_prechain_backup` (2,579,655 rows, DO NOT DROP) ·
>   2,015,321 classified/stamped `v2-ranges-2026-08-28` (needs_review 8.1%) · `_reclass_pf` materialized (5,364
>   pitchers) · baseline armHB SIGN CHECK PASSED 18/18 · 2,015,321 scored + recentered (every type×hand bucket exactly
>   100.0) · step 4 all 48 dimensions + `populate_hitter_run_values`. **Still open on staging:** step 5
>   `derive_masters_from_pitchlog.ts` is DRY-RUN ONLY (0 hitters / 4,675 pitchers would change; never applied on ANY env).
> - **PROD (historical):** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

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
## team_season_stats PITCHING RATES → pitch-log-primary (staging 2026-08-19)
Trevor's outs-tracking IP method (track outs column transitions per half-inning, not atbat_desc parsing) UNLOCKED pitch-log pitching
rates. refresh_team_season_stats() step 4a/4b:
- IP = Σ(max(outs)+1)/3 over pitching half-innings (game key incl score-pair for DH split). corr 0.9932 vs Master IP.
- K9/BB9/HR9 = pitch-log counts (pk/pbb/phr from step 3) ×9 / IP. WHIP=(pbb+ph)/IP. FIP=(13·phr+3·(pbb+phbp)−2·pk)/IP + 3.157 (cFIP D1 2026).
- ERA = Master IP-weighted (SOURCE-OF-TRUTH). Pitch-log ERA = 0.825 corr (earned-run attribution via runs−(UR) is imperfect — inherited
  runners/errors), so ERA stays official. K9/BB9/HR9/WHIP corr 0.996+; FIP mean matches Master.
VERIFIED: 308/308, 0 null; Arkansas IP 532/K9 10.7/FIP 4.48/ERA 4.74; D1 avg IP 465 (smaller programs)/K9 8.33/FIP 5.03/ERA 6.16.
ERA-source (Master) is the documented recommendation; overridable to pitch-log ERA if Trevor prefers. Hitting already pitch-log (step 2);
Master-reconcile fill (step 2b) fills hitting from Master where pitch-log absent (no-op 2026 D1). FOLLOW-ON remaining: reg-window pitch-log rates; park_code backfill.
## ★★★ SESSION STATE + WHAT'S-NEXT PLAN (2026-08-19)
### DONE this session (staging, all verified + committed)
- team_season_stats table (117+ cols) + refresh_team_season_stats(season) — ONE idempotent routine, the descriptive STORE stage of
  the unified upload edge fn. Rebuilds: WAR matrix (Σ Masters desc_*), hitter_war (o+d+bsr) + rotation/bullpen split, hitting
  rates+counting (pitch-log-primary), pitching counting (pitch-log), pitching rates (outs-tracking IP + K9/BB9/HR9/WHIP/FIP
  pitch-log; ERA=Master source-of-truth), records (pitch-log outcomes), conf context, faced_stuff_plus/htp, park snapshot,
  snapshot/champion carry, Master-reconcile fill. 308 D1 teams; every block A/B-verified.
- Decisions locked: pitch-log-primary rates (Master=occasional source-of-truth fill); federate-by-era (team_war_snapshots KEPT for
  2025 — unrecomputable; team_season_stats canonical 2026+); hitter-WAR pivot (Lineup oWAR→full-team Hitter WAR everywhere); ERA=Master.
- pitcher_full_name CORRUPTION fixed (was = batter name): backfilled from pitcher_id→players real name (each pitcher_id now 1 name). Ingest fix pending.
- park_code/game_string backfill RUNNING (from DRS CSVs; saved big-write process).

### IN FLIGHT
- park_code UPDATE (background, saved process) → verify + RESTORE role timeout to 2min.
- WIRE C frontend repoint (agent) → review diff + tsc + PAGE-LOAD verify the 2 Compare cards.

### WHAT'S NEXT (ordered)
1. FINISH park_code: verify ~2.58M populated; RESTORE role statement_timeout='2min'; rebuild pitch-log park factors keyed by
   park_code+team_id; re-key records/outings on game_string (fixes DH merges + the 2 pitch-count artifacts). Drop _park_code_fix + fix_parkcode.
2. FINISH WIRE C: review agent diff, tsc clean, PAGE-LOAD both Compare cards (TB Analytics + GM Analytics), commit. NO retire (federate by era).
3. team_season_stats finish (optional): DRS-accurate ra9 rollup (desc_ra9), reg-window pitch-log rates.
4. INGEST FIXES: ingest_pitch_log.ts pitcher_full_name mapping (maps CSV 'fullName'=batter → wrong); park_code ingest logic already correct.
5. PROD PUSH — the team_season_stats system (per PROD_MIGRATIONS_TODO §team_season_stats): CREATE table + refresh fn + call per season;
   pitcher_full_name backfill (build _pitcher_name_fix from prod + fix_pnames loop); park_code backfill (load CSVs → _park_code_fix →
   raised-timeout UPDATE); + the queued park/conf/is_conf/HTP/Bucket-A migrations. Via Trevor's PR/paste flow (staging→main).
6. RESUME THE MAIN GOAL — the ONE edge fn / projection pipeline. team_season_stats is a store stage of it. Pre-edge-fn punch list
   remaining: #5 position-of-need, #6 transfer-engine sync (3 copies), #7 dead-code audit → edge fn 6b projections → 7c snapshots
   (fixes TB oWAR regression) → NIL wiring. See docs/HANDOFF_STUFF_PLUS_2026_08_16 + transfer-engine audit.
## ★ WIRE C (team_season_stats frontend repoint) — STASHED INTO THE EDGE-FN / LIVE-COMPUTE-REPOINT PHASE (Trevor 2026-08-19)
Do NOT do a partial repoint now — the current-build side needs a snapshot/edge-fn change, so the whole pivot goes with the
"repoint all live-compute display spots" work (§LIVE-COMPUTE ELIMINATION / edge-fn phase). Full spec + findings (so that phase doesn't re-investigate):

### 4 files to change
- src/hooks/useTeamWarSnapshots.ts — hooks useTeamWarSnapshot(L63), useWarBenchmarks(L129), useNationalSeedBenchmark(L161),
  useAllTeamSnapshots(L211). FEDERATE BY ERA: season>=2026 read team_season_stats; season<2026 keep team_war_snapshots (2025 unrecomputable).
- src/gm/pages/GMAnalytics.tsx — current-build calc L65 (lineupOwar=hitters.slice(0,9).war), rotation/bullpen L63-64, deltas L214/223, label L185.
- src/pages/team-builder/tabs/AnalyticsTab.tsx — hero strip "Starting Lineup oWAR" L827-838 (starterTotalOwar/priorYearLineupDelta),
  benchmark "Lineup oWAR"/"Δ Lineup" L337/369, prorated_starting_lineup_owar reads L386/781, slice(0,9) L185.
- src/integrations/supabase/types.ts — add team_season_stats Row type (~L2499 near team_war_snapshots).

### Field mapping (REG-season basis, NO proration)
prior raw/prorated_starting_lineup_owar → hitter_war_reg ; rotation_pwar → rotation_pwar_reg ; bullpen_pwar → bullpen_pwar_reg ;
total → total_war_reg ; carry is_national_champ/is_conference_champ/national_seed_rank. Drop proration (use _reg directly).

### Hitter-WAR pivot (RELABEL "Lineup oWAR"/"Starting Lineup oWAR"/"Δ Lineup" → "Hitter WAR"/"Δ Hitter")
- Prior-season side = team_season_stats.hitter_war_reg (full-team o+d+bsr).
- ⚠ CURRENT-BUILD side BLOCKER: gm roster row.war = the player_snapshot's o_war (oWAR ONLY) — snapshot at process-precompute-jobs/
  index.ts:1729/1753 stores {..., o_war, ...}; the hPred query L1672 selects o_war but NOT d_war/bsr_war/total_hitter_war. player_predictions
  HAS o_war/d_war/bsr_war/total_hitter_war/p_war (composite via refresh_composite_war L1885). ⇒ to make the current build = full-team
  hitter WAR (o+d+bsr), PLUMB total_hitter_war INTO the hitter snapshot (add to L1672 select + L1729/1753 snapshot) + RE-PRECOMPUTE, and
  change useGmRoster to read total_hitter_war (or the AnalyticsTab build calc). Then both sides = o+d+bsr, consistent. Pitching keeps rotation/bullpen split.
- Until then: current-build stays oWAR — which is WHY we don't do a partial repoint (would show o+d+bsr prior vs oWAR current = mismatch).

### Verify: tsc -p tsconfig.app.json (no NEW errors in touched files) + PAGE-LOAD both Compare cards (Trevor can view). NO table retire (federate by era).
## ★★★ NEXT-PHASE PLAN + CLARIFICATIONS (Trevor 2026-08-20)
### park_code / neutral sites — NOT just polish (Trevor correction)
The team_id home/away park-factor method does NOT pick up NEUTRAL-SITE games (a neutral game is "home" for neither team → the
home/away filter misses it entirely). park_code keys by the ACTUAL STADIUM regardless of home/away, so it's REQUIRED to capture
neutral-site park effects (regionals, MLB-park showcases, tournaments). ⇒ after park_code fills, re-derive pitch-log park factors
keyed by park_code (+ team for the batting context) so neutral sites are attributed to the right park. Also re-key records/outings on game_string.

### PROD PUSH — LOG EVERYTHING, do NOT push yet (Trevor)
We are NOT pushing to prod yet. Keep logging EVERY schema/SQL/backfill change to PROD_MIGRATIONS_TODO.md (the whole team_season_stats
system + name/park_code backfills + queued park/conf/is_conf/HTP/Bucket-A migrations). The push happens later via Trevor's PR/paste flow.

### DO THESE NOW (Trevor: "yes do this")
1. DRS-accurate ra9 rollup — team ra9 from Master desc_ra9 (IP-weighted) = the accurate pitch-log run-prevention rate (ERA stays Master).
2. Reg-window pitch-log rates — add _reg variants of the pitch-log rates (currently total-season only).
3. ingest_pitch_log.ts pitcher_full_name mapping fix — it maps CSV 'fullName' (= the batter) into pitcher_full_name; fix so new ingests are correct.

### #5 POSITION-OF-NEED — SETTLED ("I like it", handoff L461-516). is_position_of_need = true/false flag: read the ACTIVE build →
per-player, if the p70 at that position isn't a starter (a need exists) → true. STORED next to dev_aggressiveness (build player meta);
re-run the check + update the flag on EVERY SAVE (roster-reactive, NOT live). transfer_snapshot→player_snapshot. Automatic+stored+roster-reactive now; coach questionnaire later. Design is done — just needs building.

### #6 TRANSFER-ENGINE SYNC — the transfer PROJECTION engine exists in 3 DRIFTED copies: canonical src/lib/*, the Deno edge fn
(process-precompute-jobs, a hand-mirror), and the TB live hook. They've diverged. Confirmed bugs: edge fn still applies pitcher PVF
(weekend-SP premium, index.ts:672) while canonical DROPPED it (→ SP transfer market ~20% high); triple-oWAR leftover (delete). #6 =
sync all 3 to canonical (strip edge-fn PVF, delete triple-oWAR, align rate-index/lgRA9). [[project_transfer_engine_audit]]. It's a CODE-consistency fix.

### #6 vs 6b vs #7 vs "finalize the edge fn" (Trevor's question)
- #6 = FIX/sync the transfer engine CODE (3 copies → canonical). #7 = DEAD-CODE AUDIT (Savant clear, dead park_factors drop, V1 conf
  retire, corrupted-col DROP, scratch drops). 6b = RUN the transfer projections (deploy the synced edge fn + FIRE transfers + A/B verify BOTH sides).
- So: #6 fixes the code → #7 removes dead code → 6b actually runs the transfer projections → 7c snapshots (fixes TB oWAR regression) → NIL.
- "Finalize the WHOLE edge function" = the Track B UNIFIED on-upload edge fn that collapses the 3 copies into ONE process (upload →
  collect/derive/store all data incl team_season_stats → run returner + transfer projections). That's the end state; 6b is a step toward it.
- WIRE C (team_season_stats frontend repoint + total_hitter_war snapshot plumbing) rides with 6b/7c.
## ★★★ BRANCH STRATEGY (Trevor 2026-08-20) — prod-push improvements FIRST, then edge-fn rework on a fresh branch
### "canonical" = the main SOURCE-OF-TRUTH version of the code (the reference impl the others match). Currently src/lib/* is canonical;
the edge fn is a hand-written Deno MIRROR that drifted. ⇒ "sync to canonical" = make the edge fn match the correct src/lib.
### TB live hook = TEMPORARY UI PREVIEW that reverts to the stored DB value on save (Trevor: "really important to remember"). NOT a
persistent engine → #6 is really only TWO persistent things (canonical src/lib + edge fn), and the edge fn is THE one that runs.
END STATE = ONE engine: the edge fn + app IMPORT THE SAME SHARED LOGIC so drift is impossible (Track B unification makes #6 mostly disappear).

### PHASE 1 — get ALL data+code improvements into PROD (current feature/war-recalibration branch)
Self-contained, verified, doesn't destabilize (team_season_stats is a store stage nothing reads yet; data fixes are pure quality).
Includes: team_season_stats + refresh_team_season_stats() + name backfill + park_code backfill + pitch-log pitching rates + park
factors + conf-stats/HTP + is_conf + BUILD #5 position-of-need + the 3 do-items (ra9, reg-window, ingest pitcher_full_name fix).
⚠ LARGE push = the whole war-recalibration accumulation (desc_* cols → model_config → pitch_log_totals → Conference Stats →
team_season_stats). DEPENDENCY ORDER MATTERS — assemble the ordered prod runbook from PROD_MIGRATIONS_TODO.md. Trevor drives staging→main PR.

### PHASE 2 — edge-fn rework on a FRESH branch off the new main
Unify the engine (edge fn imports the shared lib → no drift), plumb total_hitter_war into the snapshot, run transfer projections (6b)
+ A/B BOTH sides, land WIRE C (frontend repoint + hitter-WAR pivot), snapshots (7c, fixes TB oWAR regression), NIL. Verify in
isolation, clean up, then merge. The risky part — isolated on its own branch.

### NEXT ACTIONS (Phase 1 build order)
1. Build #5 position-of-need (is_position_of_need flag + storage + save-hook re-check) + verify functionality.
2. DRS ra9 rollup + reg-window pitch-log rates (refresh_team_season_stats additions).
3. ingest_pitch_log.ts pitcher_full_name mapping fix.
4. Finish park_code (fill + park-factor re-derive on park_code for neutral sites + records/outings re-key on game_string).
5. Assemble the ordered prod runbook. (Do NOT push — Trevor drives.)
## ★★★ PHASING REFINEMENT (Trevor 2026-08-20) — Phase 1 = FINALIZE + WIRE everything + SHIP; Phase 2 = edge-fn CLEANUP only
Correction to the earlier "WIRE C stashed to Phase 2": Trevor wants ALL the new/correct/improved data WIRED everywhere it's needed
and SHIPPED (stored + used) IN THIS PUSH — not left as unwired tables. Then a FRESH branch ONLY for the edge-function cleanup/unification.

### PHASE 1 (current branch) — finalize data calcs + WIRE the improvements into every read/display + ship stored properly
- team_season_stats + refresh routine (done) + WIRE C BACK IN (repoint Compare cards to team_season_stats era-fallback + hitter-WAR
  pivot + relabel) + descriptive WAR columns on Masters + position-of-need (#5) + park/records/rates displayed. App SHOWS correct improved data.
- ⚠ ONE SEAM: WIRE C's CURRENT-BUILD hitter cell needs total_hitter_war in the player_snapshot (edge-fn-written). Phase 1 does a
  MINIMAL TARGETED addition: add total_hitter_war to the hitter snapshot (process-precompute-jobs index.ts:1672 select + :1729/:1753
  snapshot) + re-precompute — NOT the structural refactor. Then WIRE C fully lands (both sides o+d+bsr).
- Data do-items: DRS ra9 rollup, reg-window pitch-log rates, ingest pitcher_full_name fix, park_code finish (+ park factors on
  park_code for neutral sites + records/outings re-key on game_string). Assemble ordered prod runbook. Trevor drives staging→main PR. DO NOT push.

### PHASE 2 (fresh branch off new main) — ONLY the edge-function structural cleanup/unification
Collapse the copies into ONE shared engine (edge fn + app import the same lib → drift impossible), #6 transfer-sync structurally,
DEAD-CODE audit, Track B one-process (upload → collect/store all incl team_season_stats → run returner+transfer projections), clean
transfer re-run (6b) + A/B. The risky architectural refactor — isolated, verified, cleaned up, then merged.
## PHASING CONFIRMED + PARK-FACTOR FINDING (Trevor 2026-08-20)
- PHASE 2 = the EDGE FUNCTION ALONE (structural cleanup/unification). EVERYTHING ELSE = PHASE 1: all display + wiring — WIRE C,
  #5 position-of-need, the minimal total_hitter_war snapshot touch, descriptive WAR columns, records re-key. (#5 is display+wire → Phase 1.)
- PARK FACTORS were derived off the HOME FLAG (scripts/sql/park_home_2026.sql: "a team's park = all its home games", keyed team_id) —
  NOT park_code (was null). But home-flag IS effectively park-based: a team's home games = games at their park → the factor = the
  park factor. All 308 HOME parks already correct. GAP = true NEUTRAL sites only: 310 park_codes vs 308 teams = ~2 dedicated neutral
  venues → a handful of tournament games not attributed to any park factor. MINOR. ⇒ re-deriving on park_code is nice-to-have
  (nudges the ~2-park neutral delta + proper keying), NOT urgent. THE REAL park_code PAYOFF = game_string → exact game identification
  for RECORDS/OUTINGS (fixes doubleheader merges + the 2 pitch-count artifacts). That's the substantive DB-batch win.
- FRONTEND WORKFLOW (Trevor's "what do I need to do"): agent writes ALL code + tsc-checks, then hands Trevor a per-page CHECKLIST
  (open page X → confirm card/number Y). Trevor just page-loads + eyeballs. That IS the whole page-load gate.
## park_code PAYOFF DELIVERED — records on game_string (staging 2026-08-20)
refresh_team_season_stats step 5 now keys games on game_string (cs-<park><date8><game#> = exact game id, DH-safe) instead of the
score-pair heuristic. Records unchanged (Georgia 53-14 (23-7), Arkansas 41-22, avg 55 games = consistent) but now EXACT. Same
game_string is available for any per-pitcher outing analysis → the Ohman(502)/Beaty(345) merge artifacts resolve when keyed on game_string.
REMAINING PHASE-1 DB batch: DRS ra9 rollup, reg-window pitch-log rates, ingest_pitch_log.ts pitcher_full_name fix.
REMAINING PHASE-1 FRONTEND: #5 position-of-need wiring (positionNeed.ts built, wire stored-not-live), WIRE C (Compare cards + hitter-WAR pivot + total_hitter_war snapshot touch).
## PHASE-1 DB BATCH (staging 2026-08-20)
1. DRS ra9 + reg-window pitching — DONE. refresh step 4c: ra9_total/ra9_reg/fip_ra9_total/fip_ra9_reg from Master desc_ra9/_reg
   (IP-weighted; DRS-accurate run prevention). avg RA9 6.36 > ERA 6.16 (unearned). Covers reg-window PITCHING (+ WAR already reg-split).
2. Reg-window RATE SET (avg/obp/slg/era/k9 etc) — pitch_log_*_totals are 'all'-dimension only, so the full reg-window rate set needs
   a 'reg' dimension added to aggregate_pitch_log_dimensions.ts (+ re-run) OR a raw date-filtered pitch_log aggregation. SEPARATE
   follow-on (heavier). Delivered so far: WAR reg/total + RA9 reg/total.
3. INGEST pitcher_full_name — RE-DIAGNOSED: DRS CSVs have fullName=PITCHER (correct); ingest mapping is fine for that format. Original
   corruption = a different/older source. ROBUST FIX = standard post-ingest resolve pitcher_full_name from pitcher_id (fix_pnames).
   ⚠ VERIFIED via proper quote-aware parse (112-col CSV with comma-fields breaks naive comma-split — always use a quote-aware parser).
## ★★★ RE-PRIORITIZED (Trevor 2026-08-20): CORRECT VALUES → STORE → DISPLAY → then (wiring stage) position-of-need
Order: get correct transfer values → store → display, THEN worry about functions/storing like position-of-need. #5 position-of-need
MOVED to the wiring stage (later). Input-mapping-from-correct-sources = part of the whole edge function.

### TRANSFER-FUNCTION CORRECTNESS (Phase 1, the real work)
1. #6a PVF — DONE (stripped e5fe955; market_pvf_weekend_sp:1.2 @ index.ts:533 is a DEAD constant, cleanup only).
2. #6b oWAR TANGLE (revised — NOT a dead-line delete): the DISPLAY reads transferProjection.owar (hardcoded 260-PA @
   transferProjection.ts:124) while the STORED path uses depth-role PA (computeHitterOWar) → they DISAGREE. Consumers of the 260-PA
   owar: PlayerTableRow.tsx:174, AnalyticsTab.tsx:138/172/184/626, useTeamBuilderSimulation. FIX = reconcile display→depth-role oWAR.
3. ★ SD AUDIT (Trevor's added point — the crux) [[project_stuff_opr_sd_audit]]: the projection scales each conference/competition/park
   delta by an SD constant. transferPitcherProjection.ts projectLower/projectHigher args include era_pr_sd, era_plus_ncaa_sd, +
   competition_weight×HTP, park_weight×rg. Those *_sd live in eq (transferWeightDefaults.ts / model_config), DERIVED FROM OLD DATA.
   We recomputed Stuff+, park factors, HTP, conf rates, power ratings → their SDs SHIFTED → the eq *_sd are STALE → every lever
   mis-weights. RE-DERIVE all *_sd (PR SDs, plus-NCAA SDs, HTP SD, park rg SD, Stuff+ SD) off CURRENT data → update eq. GATES correctness.
4. INPUT MAPPING — point competition/env at the corrected team_season_stats faced Stuff+/HTP + park (part of the edge fn).
Weight config: src/lib/transferWeightDefaults.ts + model_config. Equation core: src/lib/transferPitcherProjection.ts (pitcher),
transferProjection.ts (hitter). OPEN (confirm w/ Trevor before touching): SD populations/filters; oWAR-reconcile target = depth-role.

### PHASE 2 = edge-function STRUCTURAL cleanup ALONE (unify copies → one shared lib, dead-code). Outputs unchanged.
## ★★★ SD AUDIT — METHODOLOGY FOUND + PLAN (Trevor 2026-08-20). DO NOT restructure env+ (100-avg scale is fine); ONLY audit the SD that scales each lever's weight.
### env+ formula IS in the code (src/lib/powerRatings.ts) — no reconstruction needed:
- eraPrPlus = (eraRaw/50)*100  (:320) — direct scale to 100-average
- hr9PrPlus/k9PrPlus/bb9PrPlus = (raw/50)*100  (:350 etc.)
- fipPrPlus = WEIGHTED COMPOSITE of hr9PrPlus+bb9PrPlus+k9PrPlus (FIP_WEIGHTS) (:352-359) — different spread BY CONSTRUCTION (composite, not a single /50*100)
- overallPrPlus = (eraPrPlus+fipPrPlus)/2  (:361). Hitter: baPlus/obpPlus/isoPlus/overallPlus (:145-151).
### WHY SD grew (Trevor): we REMOVED the old ×20 pitching consistency scale to make ONE consistent equation for hitter AND pitcher
(didn't have that before). So the pitching env+ now sits on a wider scale → cross-conf SD legitimately LARGER than the stored 2026-05
values (era+ 9.4/fip+ 6.2/etc). REAL change, not a formula mismatch. It's on THIS push-to-prod, so the equation change is already in.
### THE WEIGHT MECHANISM (transferWeightDefaults.ts + model_config): conference_weight = 0.025 × D1_cross-conf_SD (≈2.5%/SD);
competition_weight = 0.05 × HTP_SD (≈5%/SD, HTP dominant). Stored SDs (now stale): era+ 9.4·fip+ 6.2·whip+ 5.3·k9+ 7.9·bb9+ 8.6·hr9+ 17.3·HTP 14.1.
### DRIFT CHECK (D1 cross-conf, current): HTP SD 14.3 (≈ stored 14.1 → the DOMINANT competition lever is STABLE). Pitching env+ SDs grew
(from the ×20 removal). ⚠ FILTER: D1 only — the 40-vs-30 conf gap likely includes JUCO; audit must exclude JUCO. Full-season values (not reg regulars).
### DELIVERABLE (Trevor confirmed format): one table BOTH hitting + pitching, D1-only —
| Stat | env+ SD (now) | % impact (now) | old weight | recommended weight |
Compute cross-conf SD of the CURRENT env+ (per powerRatings.ts formula) → recommended weight = 0.025×SD (conf) / 0.05×SD (competition/HTP).
Trevor approves before any weight changes. Config lives in transferWeightDefaults.ts (JUCO) + model_config (D1). ⚠ Trevor will point to
the EXACT weight/SD from the equation — confirm which projectLower/projectHigher SD arg (era_pr_sd vs era_plus_ncaa_sd vs conf-delta SD) is the target.

### ALSO (this session, for the record): oWAR reconcile = drop 260-PA, use DEPTH-ROLE PA (auto-filled) + defensive IP by role +
pitching IP by role; scale WAR by role PA/IP in BOTH storage + display; 1-for-1 but live-reactive to toggle/role changes (belongs in the
projection engine). PVF already stripped (e5fe955; dead constant @ index.ts:533). #5 position-of-need → moved to WIRING stage (later).
Re-priority: correct values (transfer #6 + SD audit + input mapping) → store → display → then wiring-stage functions.
## ★★★ SD AUDIT — STORAGE GAPS (Trevor 2026-08-20): env+ scale CONFIRMED consistent; 2 things must be STORED not live/hardcoded
### CONFIRMED: env+ all on the /50*100 100-average scale (powerRatings.ts). FIP+ = weighted avg of hr9+/bb9+/k9+ (each /50*100) → lands
on 100-scale. 132 = 32% above avg, real. ×20 pitching multiplier REMOVED → one consistent equation hit+pitch → pitching env+ now wider
scale → cross-conf SD legitimately larger than the stored 2026-05 values. DO NOT touch env+.
### GAP 1 — per-conference PITCHING env+ NOT stored. Conference Stats stores HITTER env+ (ba_plus/obp_plus/iso_plus/slg_plus/
hitter_talent_plus/Stuff_plus) + Overall_Power_Rating (SEC 119.4) but NOT the individual era+/fip+/whip+/k9+/bb9+/hr9+ per conference —
those are LIVE-computed in the projection. Trevor: they SHOULD BE STORED (Conference Stats columns + conference-page display), stored-not-live.
### GAP 2 — the SDs themselves (the audit target) are HARDCODED in a transferWeightDefaults.ts COMMENT (era+ 9.4·fip+ 6.2·whip+ 5.3·
k9+ 7.9·bb9+ 8.6·hr9+ 17.3·HTP 14.1). Must be TRACKED/STORED (a real config row) so weights derive from a stored auditable source, not a
stale comment. SD = CONFERENCE-to-conference (cross-conf) SD (Trevor: "conference to conference impact so it is conference SD").
### AUDIT = 3 pieces: (1) compute+store per-conf pitching env+ (/50*100) in Conference Stats + display; (2) compute+store the cross-conf
SDs (hit+pitch, D1-only JUCO-excluded, full-season) as tracked config replacing the hardcoded comment; (3) table Stat|env+ SD now|% impact
now|old weight|recommended weight → weights = 0.025×SD (conference) / 0.05×HTP_SD (competition). Trevor approves before weight changes.
### OPEN (confirm w/ Trevor): where to STORE the SDs (model_config vs dedicated SD config table); pitching env+ as new Conference Stats columns.
### SAMPLE (SEC, D1): HTP 130.3, iso_plus 119.3, ba_plus 94.3, Overall_Power_Rating(pitch) 119.4, offensive_power_rating NULL (also a gap — hitting overall PR not stored at conf level).
## ★★★ CONFERENCE STATS STORAGE AUDIT (Trevor 2026-08-20) — more gaps than just pitching env+
Coverage (D1, 40 conference rows): Stuff+ 40/40 · Overall_Power_Rating(pitch) 40/40 · ba_plus 40/40 ✓. GAPS:
- HTP (hitter_talent_plus) 30/40 · WRC_plus 30/40 · run_env_factor(park) 30/40 → 10 conferences MISSING these.
- offensive_power_rating (hitting OPR) 0/40 → NEVER stored.
- pitching per-stat env+ (era+/fip+/whip+/k9+/bb9+/hr9+) → NO COLUMNS (live-computed only).
- Park per conf = only run_env_factor.
⇒ 40-vs-30 SD-POPULATION ISSUE: 40 D1 rows but only 30 fully populated → the 10 partial confs drag the cross-conf SD. MUST resolve
(fill the 10 or exclude from D1) before the SD numbers are trustworthy. OPEN — Trevor to decide: fill the 10 or exclude.
STORAGE BUILD (all Trevor-confirmed): (1) fill EVERY per-conf gap — pitching env+ (new Conference Stats columns, /50*100), hitting OPR,
+ the 10 missing HTP/WRC/park; (2) store cross-conf SD per metric in model_config + admin display (informational; the 0.025×SD WEIGHT is
what's used + is saved/displayed in multiple spots — store SDs "for consistency"); (3) LOG the edge fn to UPDATE all of these ON UPLOAD
(stored-not-live); (4) the audit table (Stat|env+ SD now|% impact|old weight|recommended weight, both hit+pitch) after population is clean.
Trevor: "make sure HTP, Stuff+, Park factor, OPR, and the other metrics per conference are stored in Conference Stats."
## ★★★ % IMPACT FORMULA (transferPitcherProjection.ts projectLower/projectHigher) — CALCULATE, don't assume (Trevor 2026-08-20)
projected = blended × (1 − confTerm + compTerm + parkTerm), where:
  confTerm = confWeight × ((toConfEnv+ − fromConfEnv+)/100)   [conference lever]
  compTerm = compWeight × ((toHTP − fromHTP)/100)             [competition/HTP lever]
  parkTerm = parkWeight × ((toPark − fromPark)/100)           [park lever]
  (powerAdj = ncaaAvg ∓ ((prPlus−100)/prSd)×ncaaSd ; blended = last×(1−powerWeight)+powerAdj×powerWeight)
⇒ A lever's % IMPACT for a 1-SD conference difference = weight × (SD/100). (For HTP: compWeight × SD_HTP/100 — CALCULATE with the
real D1 compWeight + real SD, do NOT assume "5%".) Recommended weight per methodology: conference = 0.025 × SD ; competition = 0.05 × SD.
D1 EQUATION ONLY — ignore all JUCO weights (JUCO_PITCHING_TRANSFER_WEIGHTS etc.). D1 weights live in model_config (DB).

## D1 cross-conf SDs (30 real D1 confs, JUCO NJCAA-D1 excluded) measured 2026-08-20:
HTP 14.31 (stored 14.1 → STABLE) · Stuff+ 3.48 · ba+ 3.91 · obp+ 3.47 · iso+ 12.47 · slg+ 5.94 · wRC+ 3.41 · OPR(pitch) 7.99.
Pitcher per-stat env+ (era+/fip+/whip+/k9+/bb9+/hr9+) NOT stored → COMPUTE (/50*100 on conf pitcher scores) + STORE in Conference Stats
(new columns) + display + edge-fn updates on upload. Also fill offensive_power_rating (hitting OPR, 0/40). The 40-vs-30 = the 10 NJCAA-D1
districts (JUCO) mislabeled division='D1' — EXCLUDE from D1 SD (leave JUCO untouched, not needed now).

## PLAN (all D1, stored-not-live): (1) compute+store per-conf pitcher env+ + hitting OPR in Conference Stats + edge-fn-on-upload;
(2) compute+store the cross-conf SDs (config, e.g. model_config, + admin display — informational; the derived WEIGHT is used + saved
in multiple spots); (3) table Stat | SD now | % impact (=weight×SD/100) | old weight | recommended weight (=0.025×SD conf / 0.05×SD comp)
for Trevor approval before any weight change. Config: model_config (D1 weights) + transferWeightDefaults.ts.
## ★★★ SD TRACEABILITY (Trevor 2026-08-20) — what's stored vs the gap
### STORED + TRACEABLE (model_config, displayed on admin PitchingEquationsTab / AdminDashboard):
- t_*_std_ncaa = raw-stat PLAYER SD (t_ba 0.043455, t_obp 0.046781, t_iso 0.078498) + r_* returner variants.
- t_*_std_pr / std_power = POWER-RATING PLAYER SD (t_ba 31.297, t_obp 28.889, t_iso 45.423).
These feed the POWER term: powerAdj = ncaaAvg ∓ ((prPlus−100)/std_pr)×std_ncaa. TRACEABLE. ✓
### NOT STORED (the gap Trevor flagged): the CROSS-CONFERENCE env+ SD (ba+ 3.91/obp+ 3.47/iso+ 12.47/era+ 9.4/…/HTP 14.1) — only
in a transferWeightDefaults.ts COMMENT, never a config value. ⇒ STORE IT (model_config config rows + admin display) as part of this work
so every lever's % impact is auditable from stored numbers, not a comment.
### KEY CLARIFICATION: the D1 CONFERENCE weight is a FIXED coefficient (t_ba_conference_weight=0.3), NOT 0.025×SD — that formula is
JUCO-PITCHING-ONLY. So for the D1 equation the cross-conf SD was never an INPUT (nothing to have stored); it's the DIAGNOSTIC that gives
each lever's % impact = weight × (cross-conf SD/100). Storing it makes the impact traceable + lets us re-tune weights to a target % impact if the SD shifts.
### CONFIRMED STABLE (measured off current end-of-season Conference Stats, 30 D1 confs): HTP 14.31 (vs 14.1 stored), and the hitter env+
SDs (ba+/obp+/iso+) are current live values (no stored old to diff, but env+ formula unchanged for hitting → Trevor: "tight SDs, wouldn't
change a ton"). The one that MOVED = pitcher env+ SD (×20 removal). 
### PLAN unchanged + expanded: (a) compute+store per-conf PITCHER env+ + hitting OPR in Conference Stats (edge-fn on upload); (b) STORE
the cross-conf SDs (model_config + admin display) — fixes traceability; (c) audit table Stat | cross-conf SD now | % impact (=weight×SD/100)
| old weight | recommended weight, both hit+pitch, D1-only; Trevor approves before weight changes. Admin UI: PitchingEquationsTab.tsx / AdminDashboard.tsx already display equation SDs → add cross-conf SD there.
## ★★★ SD AUDIT — OLD(prod) vs NEW(staging) % IMPACT COMPARISON (Trevor 2026-08-20). Both on the /50×100 100-avg scale
(prod pr_plus already on it — the comment's era+ 9.4 was an OLDER ×20-era measurement, NOT prod; the "×20 grew everything" story was WRONG).
Weights (pitchingEquations.ts D1 defaults): conf era/fip/whip/bb9/hr9=0.3, k9=0.4 ; competition era=0.5. Hitter (model_config): conf ba/obp=0.3, iso=0.15 ; competition(vs Stuff+) ba=1.0/obp=0.85/iso=0.75. %impact = weight × SD/100.
### PITCH conf %impact old→new: whip+ 8.99→22.62 SD ⇒ 2.70%→6.79% ⚠ (SD TRIPLED, the one big mover) · k9+ 23.10→23.63 9.24→9.45 ·
era+ 16.34→16.05 4.90→4.82 · bb9+ 13.18→15.11 3.95→4.53 · fip+ 11.79→10.87 3.54→3.26 · hr9+ 6.51→9.51 1.95→2.85.
### HIT conf %impact old→new: ba+ 3.99→3.91 1.20→1.17 · obp+ 3.49→3.47 1.05→1.04 · iso+ 12.35→12.47 1.85→1.87 (all STABLE).
### COMPETITION: Stuff+ (hitter comp) 3.69→3.48 (ba 3.69%→3.48%); HTP (pitcher comp) 14.1→14.31 (era 7.05%→7.16%). STABLE.
### FINDING: Trevor's instinct right — nearly everything STABLE. ONE real mover = whip+ (SD ~tripled 8.99→22.62 from this session's
power-rating recompute) → WHIP conf impact 2.70%→6.79%; hr9+/bb9+ moderate. ⚠ CONFIRM whip+ jump is intended, not a recompute artifact,
BEFORE re-tuning weights. Prod-read method: supabase-js paginate Conference Stats(ba/obp/iso_plus,Stuff_plus D1 excl NJCAA) + Pitching
Master(pr_plus IP-weighted per conf); prod lacks hitter_talent_plus/pitching-env+ cols (added this session → prod = pre-change baseline).
### DELIVERABLE for Trevor: the old→new %impact table above + Stuff+/HTP rows. Decisions pending: (a) verify whip+ SD; (b) re-tune weights
(equalize hit/pit conference impact? restore old %impact?); (c) then store per-conf pitcher env+ + cross-conf SDs (traceable) + make the run.
## ★★★ SD AUDIT — DEFINITIVE RESULT (Trevor 2026-08-20). SUPERSEDES the earlier "whip+ tripled / k9 9%" finding (that was a METHOD BUG).
### THE BUG: I computed pitcher env+ SD from PLAYER pr_plus (IP-weighted, /50×100, wide spread) → inflated (era+ 16, k9+ 23.63 → k9 9% impact).
### THE FIX: the CONFERENCE env+ (fromEraPlus/fromK9Plus) the equation uses = calcPitchingPlus(conf_rate, ncaa_avg, ncaa_sd, SCALE=20)
  = 100 + z×20 (buildTransferPitcherInputs.ts:269; params pitchingEquations.ts:200-235: era avg6.21/sd1.5879, fip 5.08/1.000, whip 1.64/0.2521,
  k9 8.21/1.990, bb9 4.82/1.3407, hr9 1.12/0.4677, ALL scale=20). ⇒ env+ cross-conf SD = conf_rate_SD × 20/ncaa_sd. (Trevor's "×20" = this scale, STILL in the code.)
### FINAL SDs + %impact (weight×SD/100), D1 30 confs, OLD(prod)→NEW(staging), correct method:
  era+ 7.45→7.30 (2.24%→2.19%, wt .3) · fip+ 6.73→6.78 (2.02→2.03, .3) · whip+ 7.36→7.69 (2.21→2.31, .3) · k9+ 7.25→7.35 (2.90→2.94, .4) ·
  bb9+ 6.90→7.28 (2.07→2.18, .3) · hr9+ 9.84→10.14 (2.95→3.04, .3) · HTP 14.1→14.31 (7.05→7.16, .5) · ba+ 3.99→3.91 (1.20→1.17, .3) ·
  obp+ 3.49→3.47 (1.05→1.04, .3) · iso+ 12.35→12.47 (1.85→1.87, .15) · Stuff+ 3.69→3.48 (3.69→3.48, ba wt 1.0).
### CONCLUSION: ALL SDs STABLE (within ~6%); every %impact moved <0.2pt. End-of-season reruns did NOT materially change the SDs.
NO WEIGHT RE-TUNE NEEDED — levers as designed (conf 1-3%, HTP dominant ~7%, Stuff+ ~3.5%). Trevor's instinct correct on every count.
### STILL TO DO (storage/traceability, not re-tune): store per-conf env+ (pitcher via calcPitchingPlus scale-20) + cross-conf SDs (config +
admin display) so the audit is traceable; HTP IS derivable on prod from stored OPR/Stuff+/WRC+ (hitter_talent_plus column added this session).
Then transfer correctness (oWAR depth-role reconcile + input mapping) → the run.
### KEY LESSON: conference env+ = calcPitchingPlus scale-20 on the CONFERENCE RATE, NOT the player pr_plus (/50×100). Don't conflate the two.
> ### ⚠ HISTORICAL LOG FROM HERE (2026-08-28 → 08-29). Read it as an audit trail, NOT as instructions.
> These entries record the day-by-day reconstruction of the classifier. Several of their intermediate conclusions were
> later overturned. The CURRENT truth is at the top of this file and in the consolidated sections at the bottom:
> classifier = `src/savant/lib/stuffPlusClassifierV2.ts` at **95.2% / 95.3%** (not 85.2 / 90.2 / 91.5 / 92.6 / 94.3 /
> 95.1%); there is **no "A5 aggregator" to build** (PSP-I is the legacy lane); the rollup is
> `derive_masters_from_pitchlog.ts`, **never** `legacy_rollupStuffPlusToMaster`; and staging **is** being overwritten
> with v2.

## ★★ CORRECTION (2026-08-28) — the "classifier v2" ran IN-DB and was NEVER committed as code
Discovered while trying to rebuild the per-pitch reclassification for the prod push. **The classifier that produced staging's
final `pitch_log.pitch_type_reclassified` (`_reclass_result`, 2M) is NOT in the repo.** Commits `8827a38`/`63b0edd`
("stuff+ phase 1: classifier v2 … in-DB") touched **only docs**. So the v2 refinements ran as **ad-hoc SQL in the Supabase
editor** and only the OUTPUT survived. Specifically NOT committed: the **FASTBALL movement split** (FA/SI → 4S vs Sinker by
`IVB−|armHB|`; "~20% of tagged 4-seams are sinkers"), the **v2 breaking thresholds** (the committed `reclassifyRHP` Cutter
rule `ivb>3` is an EARLIER, more-aggressive version — it does NOT reproduce staging, plateaus ~73%), the **cross-label
anchor-gravity override**, and the **per-pitch propagation** to pitch_log. COMMITTED + reusable: `reclassifyRHP/LHP` (breaking,
earlier), `movementDistance=√(dIVB²+dHB²)`, `consolidate()` (within-label dedup, exact 4"/6"/5% constants, `BREAKING_BALL_TAGS`
family guard). GROUND TRUTH stored on staging (RLS-locked): `_reclass_result`, `_reclass_map` (pitcher×seed→label),
`_reclass_pf` (pitcher→pf_velo). **The exact v2 SQL, if it survives, is only in the staging Supabase SQL-editor history (~08-16/17)
or a local `.sql` scratch file.** Full writeup + Track-B rebuild scope: `docs/STUFF_PLUS_RECLASS_REBUILD_PLAN.md` §"INVESTIGATION FINDINGS".
**LESSON: never run a load-bearing derivation as ad-hoc in-DB SQL — commit it. The classification is the heart of Stuff+ and it
lived only in scratchpad + its stored output.**

## ★★ UPDATE (2026-08-28) — the in-DB classifier v2 IS RECOVERABLE from `pg_stat_statements` (supersedes "only in stored output")
Staging retained the classifier SQL in `pg_stat_statements`. The exact unified CASE (curve→sweeper→fastball-gap-split(4S/Sinker/
Cutter)→offspeed(Splitter/Change-up)→Slider→Gyro, on ivb_corrected/armHB/gap/spin) was recovered verbatim; only the literal
thresholds are masked (`$N`) and get fit to `_reclass_result`. `pf_velo` per pitcher is stored in `_reclass_pf`. Full structure +
method: `docs/STUFF_PLUS_RECLASS_REBUILD_PLAN.md` §BREAKTHROUGH. **Lesson add:** even ad-hoc in-DB SQL is recoverable from
`pg_stat_statements` (when enabled) — check it before declaring a lost derivation gone; the structure survives (constants masked).

## ★ DECISION (2026-08-28): prod = ROLL OUT staging `_reclass_result` labels (bit-exact); classifier rebuild = Track B
Recovered classifier reproduces staging ~85% (structure + documented boundaries known; exact tuned constants normalized away,
survive only in `_reclass_result`). So: prod push uses staging's exact per-pitch labels (env-independent by uniq_pitch_id, keyset
copy), and the CLEAN committed classifier (corrected values in `STUFF_PLUS_RECLASS_REBUILD_PLAN.md` §"CORRECTED VALUES") is built
in Track B, validated to ~100% vs `_reclass_result`. Comprehensive: `docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md`.

---
## ★★ CORRECTION (Trevor 2026-08-28): WE ARE NOT COPYING STAGING. REGENERATE on prod.
Reverses the earlier "roll out staging `_reclass_result` labels" note above — that was WRONG. Prod reclassification = RUN THE
COMMITTED CLASSIFIER (`scripts/reclassify_backfill.ts` logic) ON PROD DATA (venue-corrected), per HANDOFF_STUFF_PLUS §E.PROD
("regenerate end-to-end, NOT copy") + [[feedback_derive_over_copy]] (derivation must work in future / Track B on-ingest).
CONSEQUENCE: the committed classifier must reproduce staging's `_reclass_result` closely FIRST (today ~85%). `_reclass_result`
is now ONLY the validation ground-truth, NOT a source to copy. `scripts/_reclass_rollout.ts` (copy path) is DEAD — do not use.

## ★★★ 2026-08-28 (later) — CLASSIFIER DESIGN RECOVERED. Tier-1 "unrecoverable" was WRONG about the DESIGN.
**PROVENANCE CORRECTION:** the Aug-16/17 v2 classifier DESIGN conversation was in **THIS marathon session's own transcript
(`7531d0c4-…jsonl`)** all along — 45 gyro/armHB hits Aug-16, 247 Aug-17. My Tier-1 hunt failed because I searched `6de1d4f8`/`9ae…`
(which hold ONLY April–July PODCAST chatter — the "clouded" data). Lesson: this session file spans Aug-16 → Aug-28; date-scope
IT (ts startswith 2026-08-16/17) and grep seam keywords. Trevor caught this before I did.
**WHAT'S RECOVERED (full design, not just boundaries): `docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`** — 4-agent date-scoped
mine + synthesis. All 7 CASE arms w/ rationale; the two SEAMS Trevor asked about **STATED verbatim**: Gyro↔Slider at **|armHB|=5**
(Gyro=|armHB|<5 & IVB∈[−4,+4]; "28% of SL-tags were gyros"), Slider↔Curveball at **IVB=−8** (refined `IVB≤−8 & armHB<4 & gap≥4`;
blend strip IVB∈[−8,−4] gap-decides). Both TIEBREAKERS recovered: CT/SL arsenal ("2nd distinct breaking ball→Cutter else Slider",
valley MEASURED at 7) + gyro/curve blend-strip (gap≤8→gyro, ≥10→curve). Anchor algo: anchors ≥60p OR ≥10% mix, fold-guard (velo/gap
family), score-and-flag needs_review (**6.86% baseline golden — alert if it drifts UP**), <150p small-sample→global-on-cluster-means.
Validation: 4-check gate (20-arm panel WAIVED), **final deployed 0.867 overall vs TrackMan 0.822** (cluster-level BEATS per-pitch
0.834 which FAILED Check 1 on breaking). Biggest edge = **FB/sinker extraction +0.072**, NOT breaking (+0.026).
**STILL UNRECOVERABLE (SILENT):** the exact TUNED literal constants (masked to `$N` in pg_stat_statements) — survive ONLY in
`_reclass_result`. So: DESIGN recovered, exact NUMBERS still fit from the answer key. 5 transcript-vs-as-built flags logged in the
spec §5, top one: fastball gate design=`gap<2` vs as-built=`gap<4` (+5%).
**MECHANIC-1 WIN (this session):** removing the Sweeper ivb-gate → 85.4%→**88.6%** vs `_reclass_result`, Sweeper→Slider 1112→270.
(Note: design keeps the SEED gate `ivb∈[−2,+6]` + folds near-sweepers via the anchor; my gate-removal APPROXIMATES the fold.)
**UPDATED A1 PLAN:** build to the RECOVERED SPEC — implement the 2 tiebreakers + anchor-fold + FA/SI cluster-mean strip (none in the
~85% `reclassify_backfill.ts` yet) → fit exact constants to `_reclass_result` → ≥95%. Far more direct than one-seam-at-a-time probing.

## ★★★ 2026-08-28 — CLEAN-ROOM v2 CLASSIFIER + a VALIDATION-SAMPLING BUG that produced MIRAGE numbers
### ⚠ METHODOLOGY BUG (critical — distrust any prior match%): validation sample was BIASED
The v2 validate pulled pitchers via `pitch_log.select('pitcher_id').limit(20000/40000)` — but **PostgREST silently caps reads at
1000 rows**, so it returned the SAME ~few high-volume arms regardless of `--sample N`. Proof: `--sample 70` and `--sample 150`
returned BIT-IDENTICAL (1160/1272 = 91.2%). So the whole ramp **85.4→88.6→90.2→91.2%** was a MIRAGE on one tiny biased set.
**FIX:** spread-sample `SAMPLE` pitchers evenly across ALL 4804 pitchers (`[...pf.keys()].sort()`, step = len/SAMPLE). **Honest
diverse-sample (120 pitchers, 55,369 pitches) = 85.2%.** LESSON: reclassifier accuracy MUST be measured on a diverse spread; any
match% that does NOT move when you change `--sample` is lying (PostgREST 1000-row cap). Distrust single-number wins on small samples.

### CLEAN-ROOM v2 — `scripts/reclassify_v2.ts` (supersedes patched `reclassify_backfill.ts`)
Trevor's call: build FROM the recovered process, not patch shortcuts. New file faithful to `STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`:
7 CASE arms (SEED-gated Sweeper — fold handles near-sweepers, NOT gate-deletion), anchor algo (seed→merge Δ(4/3.5/2.5)→label-by-mean
→anchor-fold ≥60p|≥10%→tiebreakers), fold-guard, score-and-flag `needs_review` (4.1%), small-sample<150 fallback. **This IS the A2
committed-writer foundation.** Honest 85.2% on diverse sample.

### FOLD-GUARD TOO COARSE (the real bug the good sample exposed)
`FAM()` lumps ALL breaking balls as one family "BRK" → a small GYRO cluster folds into a nearby CUTTER/SLIDER anchor (same BRK +
|Δvelo|<3) → **Gyro→Cutter 791, Slider→Cutter 335, Gyro→Slider 315**. A gyro is NOT a cutter; breaking balls are distinct pitches
that must not cross-fold (spec golden: "a bullet is a gyro"). FIX: fold breaking-ball residuals only into SAME-LABEL anchors (FB
4S/Sinker may cross-fold as one fastball family; OFF likewise). IN PROGRESS.

### Diverse-sample confusion profile (v2 85.2%, the REAL targets)
Sweeper→Slider 1733 (near-sweepers not folding to sweeper anchor) · 4S↔Sinker 1559+922 (FA/SI strip) · Gyro→Cutter 791 (fold-guard) ·
Gyro→Change 344 · Slider→Cutter 335 · Gyro→Slider 315 · Curve→Slider 303 · Cutter→Slider 251 · Change→Splitter 205 (spin ~1400 line).

## 2026-08-28 — INFORMED grinding: arsenal-mix cross-check + box-rule CEILING (~87%)
Added pitcher-level cross-check to `reclassify_v2.ts` validate (Trevor's reassessment method): per-pitcher ARSENAL-MIX overlap
(Σ min(myCount,stagingCount) per type) + worst-mismatch pitcher report. At v2 86.9% per-pitch, ARSENAL-MIX = **87.6%** — so the
per-pitch scatter mostly does NOT change arsenals (borderline pitches balance out), but the mix ALSO plateaus ~87%.
**Systematic (not scatter) misses the mix view exposed:** I UNDER-call Gyro (pitcher 297562880: my Slider:361 = staging Gyro:368)
and UNDER-call Sweeper (near-sweepers). Derived Gyro↔Slider boundary from `_reclass_result`: it's an **armHB-primary seam,
crossover armHB≈−5**; ivb barely separates (both span ivb −6..+9). BUT widening the Gyro ivb gate [−4,4]→[−4,8] **REGRESSED
86.9→86.0** (Slider→Gyro 348→795) — near-neutral-armHB pitches at ivb 4–8 are ~50/50 gyro/slider, so a wider BOX over-claims.
**CONCLUSION:** gyro↔slider (and 4S↔sinker) are 2-D (armHB×ivb) decision SURFACES that axis-aligned box rules can't capture
cleanly — and the exact surfaces are precisely the TUNED CONSTANTS that survive ONLY in `_reclass_result`. Box-rule reconstruction
plateaus ~**87%** (per-pitch AND arsenal-mix). → the ≥95% reassessment must be the STUFF+ cross-check (does Stuff+ computed from
my labels match staging's within tolerance?), not more box-tweaking. Reverted the gyro widen.

## ★★★ 2026-08-28 — BREAKTHROUGH: the classifier is TWO-STAGE (coarse SEED → per-pitcher RESOLUTION). Recovered from `_reclass_map`.
This is WHY box-rule reconstruction plateaus ~87%: staging's classifier is NOT a per-pitch rule. `_reclass_map` (37,256 rows,
pitcher×seed→label) proves a two-stage process:
**STAGE 1 — coarse per-pitch SEED into 10 buckets** (NOT the 9 final types): `4S, SI, FBSTRIP, SL, SW, GY, CB, CH, SPL, FC`.
  The critical one WE NEVER HAD: **`FBSTRIP`** (4,597 seeds) = the ambiguous fastball rr∈[−4,+4] strip, held as its OWN bucket
  (this IS the "sinker vs 4-seam" mechanism). Per-seed totals: 4S 4559 · SI 3600 · FBSTRIP 4597 · SL 4659 · SW 3423 · GY 3932 ·
  CB 3260 · CH 4153 · SPL 2002 · FC 3071.
**STAGE 2 — per-pitcher cluster RESOLUTION overrides 23.4% of seeds** (28,534 stay / 8,722 override). Top overrides (seed→label,
  % of that seed): FBSTRIP→4S 71% · FBSTRIP→Sinker 28% · **SL→Gyro Slider 33%** · GY→Slider 19% · SI→4S 6% · SPL→Change 10% ·
  SL→Cutter 4% · FC→Gyro 6% · CH→Split 3% · 4S→Sinker 3% · FC→Slider 4% · CB→Change 4% · GY→Cutter 2% · SW→Curve 1%.
  needs_review = 48% of map rows (~9% pitch-weighted).
**IMPLICATION:** the label ≈ seed 77% of the time; the OTHER 23% (the overrides) are the per-pitcher cluster decisions our box
rules skip entirely — the two biggest being FBSTRIP→4S/Sinker (the FA/SI strip) and SL→Gyro (a THIRD of slider-seeds). To learn
the CORRECT forward process (Trevor: we never saved it + 100% need it): rebuild as SEED (10 buckets incl. FBSTRIP) → per-pitcher
cluster → RESOLVE, with the resolution rules reverse-engineered from `_reclass_map` + movement. NOT copying — learning the process
from the staging labels. Tool: `scripts/_map_transitions.ts`. This UPDATES `STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md` §1/§2.
## 2026-08-28 — v2 at 90.2%/91.0% arsenal-mix (honest diverse sample). Per-hand ranges DERIVED + handedness VERIFIED (armHB unifies hands). LESSON: set boundaries at pitch CORE not p95 tail; bleed OK. See STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED §DERIVED ranges.

## 2026-08-28 — v2 at 91.5% per-pitch / 92.0% arsenal-mix (honest diverse sample). Sweeper fix: armHB≤−12 DOMINATES (ivb only excludes curve ≤−8) → Sweeper→Slider 606→223.
### The ~8.5% mismatch BREAKDOWN (from --mismatches; movement of the mismatched pitches):
- SEAM BLEED (realistic, fine): 4S↔Sinker @ rr≈±2 (rr=0 seam) · Gyro↔Slider @ armHB≈−5 (genuine overlap) · Slider↔Sweeper @ −12 edge.
- STAGING NOISE (my label defensible): Gyro→Cutter 257 = ivb+7/0-HB pitches = CUTTERS per Trevor, staging mislabeled gyro · Gyro/Slider→Change arm-side +ivb.
- TRUE error rate ~2-3%; rest is bleed + staging inconsistency. → 91.5% is a strong forward classifier. Modes: reclassify_v2.ts --validate/--derive/--mismatches.
### NEXT: Stuff+ cross-check — does the ~8% (mostly within-family bleed) move per-pitcher Stuff+? (the product-level 'good enough' test).
## 2026-08-28 — ARCHITECTURE: process is classify→SCORE→reclassify-with-scores (feedback loop, not pipeline). gyro_stuff_plus scores each breaking ball as-a-gyro; post-stuff+ full-arsenal pass flips borderline seam cases by which score is coherent. This resolves gyro↔slider/4S↔sinker bleeds box-rules can't. v2 (91.5%) = first pass; score-flip = second pass (needs scorer). See design spec §FEEDBACK LOOP.
## CORRECTION 2026-08-28: NO feedback loop / NO gyro_stuff_plus. calcGyroSlider is the SINGLE gyro eq in the unified engine (stuffPlusEngine.ts:305). Architecture is LINEAR: classify-by-ranges → full Stuff+ once (score by label) → season aggregate. gyro_stuff_plus = scratchpad cruft, drop. Supersedes the 3-stage feedback-loop entry above.

## ★★★ FINAL PROCESS (Trevor-confirmed 2026-08-28) — LINEAR classify→Stuff+, with the SEAM-LOCAL usage backfill. (supersedes the feedback-loop entries)
The forward reclassification→Stuff+ is LINEAR (no feedback loop, no gyro_stuff_plus, no score-flip — all dropped as scratchpad cruft):
1. **CLASSIFY by derived RANGES** — `reclassify_v2.ts` (10-bucket seed incl FBSTRIP → per-pitcher merge → label-by-mean → tiebreakers).
   Clear labels + ~8% seam-unclear flagged. Stage-1 = 91.5% / 92.0% arsenal-mix (honest diverse sample).
2. **TRACK USAGE %** per pitcher from the CLEAR pitches → his true arsenal.
3. **BACKFILL the unclear ~8%** = usage-weighted fold, but with a TIGHT SEAM-LOCAL PROXIMITY GATE (Trevor: "they have to be close").
   THREE cases: (a) CORE pitch far from any seam → KEEP label, usage irrelevant (a −15 IVB cluster NEVER folds into gyro no matter the
   gyro usage); (b) BORDERLINE (near a seam AND within tight movement distance of one of the two seam-adjacent pitches the pitcher throws)
   → fold to the HIGHER-USAGE of those two (usage only breaks the tie WHEN MOVEMENT CANNOT); (c) DISTINCT but far from all his pitches →
   KEEP + `needs_review` (a pitcher can throw 1 of any pitch; never erase it). GATE = tight distance to a SEAM-ADJACENT dominant pitch,
   NOT "nearest anchor" (the sloppy version swallows legit distinct pitches). This is what staging did (confirmed via `--pitcher <id>`).
4. **RUN FULL STUFF+ ONCE** — `stuffPlusEngine.ts` scores each pitch by its FINAL label (switch by pitch_type; calcGyroSlider = single gyro eq).
5. **AGGREGATE over the season** → per-pitcher true overall Stuff+ + usage %.
Saved to push-to-prod (`docs/STUFF_PLUS_RECLASS_REBUILD_PLAN.md`) + Track B (`docs/PIPELINE_pitch_log_to_projections.md`) + Track B memory.
NEXT BUILD: step-3 seam-local fold → validate vs `_reclass_result` → wire steps 4-5 (existing engine) → per-pitcher Stuff+ cross-check.

## 2026-08-28 — STEP 3 BUILT (seam-local usage backfill) → v2 92.6% per-pitch / 93.0% arsenal-mix (from 91.5%). needs_review 8.7%.
Implemented in `reclassify_v2.ts` classifyPitcher: after seed→merge→label→FBSTRIP-resolve, a cluster folds into a strictly-LARGER
dominant pitch (anchor ≥60p OR ≥10% mix) ONLY IF within a TIGHT gate: `moveDist=√(dIVB²+dHB²) < 5` AND `|Δvelo| < 3`. Usage = pick the
largest close anchor. Handles both non-anchor residuals AND a small "anchor" that's really a variant of a bigger pitch (design: "close
candidate anchors merge into one"). A non-anchor with NO larger close pitch → keep label + `needs_review` (distinct rare pitch). The TIGHT
gate is the guardrail: a −15 IVB cluster is ~15" from a gyro anchor → NEVER folds into gyro. VALIDATED via `--pitcher 205105664` (4S guy):
his n=82/n=66 variants folded → 4S, giving **4S FB 972 = staging 972 EXACT**; sweeper/curve/slider kept distinct. Remaining ~7% = seam
bleed (gyro↔slider @ armHB−5 SEED boundary — accepted) + staging noise (gyro→cutter on +ivb pitches where v2 is arguably MORE correct).
NEXT: wire steps 4-5 (run `stuffPlusEngine` on v2 labels → per-pitcher Stuff+ + usage% → aggregate) → Stuff+ cross-check vs staging → A2 prod writer.

## ★★★ 2026-08-28 — STUFF+ CROSS-CHECK PASSES (steps 4-5). v2 classification is PRODUCT-VALIDATED end-to-end.
`reclassify_v2.ts --stuffcheck` (faithful copy of the 9 stuffPlusEngine equations; aggregate v2 labels vs staging labels per
(pitcher×type×hand) → score both with the same NCAA baselines → per-pitcher pitch-weighted overall Stuff+ → compare):
**per-pitcher overall Stuff+ |Δ| mean=0.85, p50=0.44, p90=1.95 (on ~100±15 scale); 78% within ±1, 91% within ±2, 96% within ±3.**
So the ~7% classification scatter (mostly WITHIN-family: 4S↔Sinker, gyro↔slider) is Stuff+-INVISIBLE for ~91% of pitchers. Outliers
are small-sample arms (Δ17.6 was a 165-pitch guy) or the known gyro-under-call pitcher (Δ−7.2) — few + modest + inherently low-confidence.
**VERDICT: v2 (92.6% per-pitch / 93.0% arsenal-mix) is GOOD ENOUGH — the classification difference from staging does not move the product
Stuff+.** The full linear pipeline (classify→track usage→backfill→score→aggregate) is proven. REMAINING for prod: wire the A2 committed
writer (keyset) to stamp v2 labels on prod pitch_log → run the real stuffPlusEngine (steps 4-5) on prod → rollups. NO feedback loop / gyro_stuff_plus.

## 2026-08-28 — PIPELINE FIX + NEXT STEP (Trevor). v2 REPLACES v1 in the Stuff+ chain; next = Stuff+ per-row-by-label.
recompute-stuff-plus.ts step 2 runs the OLD v1 runBreakingBallReclassification → would CLOBBER v2 → DROP it (v2 classifies at pitch level;
labels in pitch_log.pitch_type_reclassified). The 3 drifted v1 copies SUPERSEDED. LINEAR process: classify(v2)→aggregate(A5: pitch_log→
pitcher_stuff_plus_inputs)→SCORE per row by label (stuffPlusEngine calculateStuffPlus, calcGyroSlider=single gyro eq)→rollup→season aggregate.
NEXT STEP = the per-row-by-label scoring (validated via --stuffcheck: |Δ| 0.85, 91% within ±2). Full plan: STUFF_PLUS_RECLASS_HANDOFF_2026_08_28 §GO-FORWARD PLAN.

---
# ★ AGENT LEARNINGS — 2026-08-29: the day lost to conflated lanes (READ THIS)

**What happened:** a full working day was burned "fixing" a Stuff+ problem that did not exist in the live product,
because two different Stuff+ lanes had been conflated and the agent inferred instead of verifying.

## The five wrong conclusions (all were stated confidently; all were FALSE)
1. "The A5 aggregator (pitch_log → pitcher_stuff_plus_inputs) is missing and must be built." — FALSE. The live chain
   never goes through PSP-I at all. Building it was work on a legacy table.
2. "The baseline deriver is missing." — FALSE. `pitcher_stuff_plus_ncaa` exists, is armHB-derived, and is correct.
3. "The live path has a pop/row convention mismatch." — FALSE. Verified consistent (CH R +14.93 / L +14.87).
4. "Left-handers are being mis-scored today; this is a prod blocker." — FALSE as stated. The bug is REAL but LATENT,
   in a lane nothing reads for 2026, and not on main. Trevor's pushback ("Volantis is 107.6 and the best projected
   pitcher — a flaw that big would have been noticed") was CORRECT and is what exposed the error.
5. ~~"v2 must replace staging's pitch_log labels." — FALSE. v2 is a 90.5% reconstruction; overwriting validated anchor
   labels with it would be a regression.~~ ⚠ **THIS "CORRECTION" IS ITSELF NOW WRONG (2026-08-29/30).** v2 measures
   **95.2% per-pitch / 95.3% arsenal-mix** (not 90.5%), and Trevor's FINAL decision is to **standardize on v2 in BOTH
   environments — DO overwrite staging's labels.** The anchor still wins the disputed residual 55.9/44.1, but that is
   only ≈0.6% of the population and it comes from a classifier with NO source code that can never be re-run or applied
   to prod. v2's purpose is PROD + Track B **and** staging — one vocabulary, one version stamp, everywhere.
   The other four items above (1-4) remain correct.

## Root causes
- **Inferring instead of tracing consumers.** The question "is this code live?" is answered by following what READS the
  output to a display, not by reading the producer or a checklist. `PitcherProfile.tsx:664` ("PITCH_LOG Switch #1,
  2026-06-23") skips PSP-I for 2026 — one grep would have prevented the entire day.
- **Trusting secondary docs.** The bulletproof checklist and pipeline doc were written during the same confused period
  and asserted the legacy lane was canonical. Trevor: "the bulletproof checklist was built while we were chasing our
  tail so there is no guarantee it was even correct." Docs written amid confusion are NOT evidence.
- **Alarming off self-built side-scripts.** A parallel `--score`/`--vsstaging` reimplementation produced "1.6% match",
  which was reported as a data problem. It was an artifact of new code scored against old-code data. NEVER raise an
  alarm from a reimplementation; verify against the committed path first.
- **Building over instead of replacing.** e5dec2f folded `hbSign` out of the shared equations for the NEW pitch-log
  caller and left the OLD aggregate caller passing raw hb. Two callers, one shared equation set, one updated.

## Rules going forward
- **Trace to a display before calling anything canonical.** Producer code and checklists prove nothing.
- **Verify empirically, on data.** The mirror-correlation test (stored hb vs stuff_plus, by hand) settled in one query
  what hours of code-reading and argument did not.
- **When Trevor's product intuition contradicts an analysis, the analysis is probably wrong.** It was, three times.
- **Distinguish LATENT from LIVE.** "Would break if run" ≠ "is broken." Severity depends on whether anything reads it.
- **A label change invalidates every downstream number** — reclassify → baseline → score → aggregate → masters must
  complete in one session.

## The durable artifact
`docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` — top-dog vs legacy lanes, the three different Volantis numbers, coverage facts,
file map. It exists so this day is never repeated. Read it FIRST, before any Stuff+ work.

---

## ★★★ THE STUFF+ CHAIN — pitch_log lane (the ONLY correct order)
Any Stuff+ step that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. It
revives the latent raw-HB bug (`e5dec2f` removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Never run it for 2026.**

1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?";
   `--target=staging` for staging). Also MATERIALIZES `_reclass_pf` as a by-product — the scorer hard-depends on it.
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves 6-8% of ALL breaking-ball volume Slider→Gyro Slider, so every
   mix-dependent artifact is invalid until regenerated. The deriver ABORTS before writing if the armHB sign check fails.
3. **Score per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   🛑 **MUST READ BEFORE RUNNING THIS STEP:** the version filter is now parameterized (`--class-version=`, defaulting to
   the v2 stamp) — it used to be hard-coded to `v1-anchor-2026-08-17`, which silently matched 0 rows and left NEW LABELS
   + OLD SCORES. This step is idempotent but does **NOT** resume: every attempt costs the FULL runtime (~36 min on
   staging, longer on prod) and a mid-run failure leaves v2 labels + STALE scores. Run it DETACHED with
   `caffeinate -dimsu -w <pid>`. Requires `_reclass_pf` (materialized by step 1).
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
   🛑 **MUST READ BEFORE RUNNING THIS STEP → see "STEP 4 — SOLVED: USE `--direct`" below.** On PROD you MUST run ALL of
   step 4 with `--direct` (the HTTP gateway cuts at ~125s; `vs_top_hitters` needs 253s on staging, longer on prod, and a
   failure HALTS the dimensions after it). Validate by CONTENT + FRESHNESS — never by exit code or row count.
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (its `readAll` pagination is now `.order(PK)`-ed — unordered `.range()` over ~2.5M rows silently dropped/duped).
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave an environment with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`; exact numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.

---

## ★★★ STUFF+ v2 CLASSIFIER — FINAL STATE + CONCLUSIONS (2026-08-30). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**SINGLE SOURCE:** `src/savant/lib/stuffPlusClassifierV2.ts`. `scripts/reclassify_v2.ts` is a VALIDATION HARNESS only —
its duplicate copy of the classifier was DELETED (that duplication is exactly why earlier numbers drifted).

**FINAL ACCURACY — full population, all 4,804 pitchers / 2,000,674 pitches of `_reclass_result`:**
**1,904,808 / 2,000,674 = 95.2% per-pitch · arsenal-mix 95.3% · needs_review 8.1%** (§11.13 — with §4.5 running BEFORE
the step-4 backfill). ⚠ **SUPERSEDED, never quote as current:** 92.6% (measured on the deleted duplicate copy),
94.3% (pre-gyro-fix), 95.1% (§4.5 running after the fold), "~85%" (the abandoned Tier-2 reconstruction), and any
"projected ~95.3-95.4%".

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied **BEFORE the step-4 backfill** (and
   therefore before `tiebreak()`). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero
   fastball/offspeed regression. Ordering is load-bearing and is worth the final +0.1pp over the "after the fold" build.

**TWO NEGATIVE RESULTS — do NOT rebuild these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**★ DECISION — STANDARDIZE ON v2 IN BOTH ENVIRONMENTS (Trevor, FINAL; EXACT_VALUES §11.12).**
The coherence partition (234 pitchers, 1,188 decidable disputes, run after all three fixes) measured that the ANCHOR
wins the disputed residual **55.9 / 44.1**. That measurement STANDS, and its cost is quantified: ≈11,700 pitches ≈
**0.6% of the population**. We pay it, because the anchor has **NO SOURCE CODE** (lost scratchpad) — it can never be
re-run, on new data or on prod — while v2 is committed, versioned, re-runnable, and is what Track B needs on every
ingest, with ONE vocabulary + a `classification_version` stamp in both environments.
→ **DO overwrite staging's `pitch_type_reclassified` with v2.** Any "do NOT overwrite staging's labels" guidance
(including the earlier framing in SOURCE_OF_TRUTH §4 and EXACT_VALUES §11.11) is **REVERSED and obsolete**.
→ **PRESERVE `_reclass_result`** — the sole surviving record of the anchor, and the regression baseline for every
future classifier change.
⚠ Limitation kept on the record: the coherence partition does NOT cover the Gyro↔Slider pair (23,048 pitches, the
largest residual) — centroids were unavailable after the §4.5 fix. Whether the −3 floor over-calls gyro relative to
physical truth is STILL UNMEASURED; do not claim it either way.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 labeled of
~2,575,996, NO `classification_version` stamp, `needs_review` all null) — **v2 has NEVER written to prod**; the prior
prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130 pitches =
29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**), correcting
prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI + an explicit
"prod, now?" and MUST be followed immediately by the rest of the Stuff+ chain.

---

# STAGE 0 — PRE-PROD BLOCKER STATUS (updated 2026-08-30): **1 OPEN, THE REST RESOLVED**
Prod's **DATA is ready** — 100.00% of prod's `is_data=true` rows (~1,906,398) are v2-classifiable, venue corrections
resolve, same games/window as staging. Every blocker was CODE or SCHEMA, and all but one have shipped.

## ⛔ STILL OPEN — the only thing blocking the prod chain
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's query against prod returns
   `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from the
   data-write "prod, now?".** (Reclassification itself is unaffected — `reclassify_prod.ts` doesn't read those columns.)

## ✅ RESOLVED — shipped; do NOT re-raise these as blockers
2. **Scorer version filter — RESOLVED.** It was hard-coded `.eq("classification_version","v1-anchor-2026-08-17")` while
   `reclassify_prod.ts` stamps `v2-ranges-2026-08-28`, so it silently matched 0 rows (new labels + old scores). It is now
   **parameterized (`--class-version=`, defaulting to the v2 stamp)**. *Evidence:* on staging steps 1→3 connected
   end-to-end and scored 2,015,321 rows. (This also supersedes the old checklist item "do NOT loosen the filter".)
3. **`_reclass_pf` producer — RESOLVED.** `reclassify_prod.ts` now materializes it as a by-product of `pfbVelo()`.
   *Evidence:* the staging run materialized **5,364 pitchers**, and step 2 read it back.
4. **`aggregate_pitch_log_dimensions.ts` prod path — RESOLVED.** It now has a prod path + a `--prod` guard, plus the NEW
   `--direct` and `--only=` flags. *Evidence:* `--direct` cleared `vs_top_hitters` on staging in 253.2s.
5. **§4.5 ordering — RESOLVED.** §4.5 runs BEFORE the step-4 backfill; measured **95.2% / 95.3%** (§11.13) — strictly
   better on both metrics than the 95.1% "after the fold" ordering, so there is nothing left to measure or revert.
6. **Ordered pagination — RESOLVED.** `derive_masters_from_pitchlog.ts` `readAll` is ordered, plus two further
   ordered-pagination fixes (`backfill_trackman_pitches_pitching_master.ts`, `compute_conf_pitcher_env_plus.ts`).
7. **Legacy lane gated out of the live prod CSV path — RESOLVED.** `scripts/import-csvs/runner.ts` (= `npm run
   import:prod`, which goes DIRECT to prod) no longer runs the legacy raw-HB lane, and npm `recompute-stuff:prod` /
   `recompute-stuff-scoped:prod` were **DELETED**. A routine TruMedia import can no longer score left-handers backwards.
8. **Ledger entries — RESOLVED.** C20 park_code (2,576,146 = 100%), C21 `is_conference_game` + C22 sequence
   (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql` are all logged in
   `PROD_MIGRATIONS_TODO.md`.
9. **Staging reclassification writer — RESOLVED.** `reclassify_prod.ts --target=staging`, with a double-keyed guard
   (it refuses unless PGURI's project ref matches the named target).

## ⚠ CLAIMS THAT ARE FALSE — audits disproved them; do not treat any of these as live blockers
"A5 aggregator (pitch_log → `pitcher_stuff_plus_inputs`) is missing" · "the baseline deriver is missing" ·
"the live path has a pop/row convention mismatch" · "the v2 reclassification WRITER does not exist" ·
"the classifier is only ~85% and cannot reach its gate". All verified present / correct / superseded.

## OPEN BUT NOT BLOCKING
- **C21/C22 derive-over-copy follow-up.** They were COPIED from staging (`_next_derived.ts`), not derived. Prod must be
  able to DERIVE `park_code` / `is_conference_game` / sequence going forward or **Track B breaks on the next ingest.**
- **Migration `20260829120000_gm_budget_nil_allocation_mode.sql`** — committed, **NOT yet applied to either env.**
- **Row-count populations, pinned so gates are falsifiable** (these are DIFFERENT populations, not a contradiction):
  2,576,230 = prod pitch_log total pre-dedup · 2,576,146 = park_code/is_conf/sequence filled · ~2,176,888 = prod rows
  carrying an OLD CASE label · 2,013,005 = the v2 prod DRY-RUN label count · **prod `is_data=true` ≈ 1,906,398**
  (74.01% of 2,575,996) · staging v2 classified/stamped = 2,015,321.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).

---

# ▶️ STAGING + PROD STATE, AND THE NEXT ACTIONS (2026-08-30)

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = **2,579,655 rows** / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review **8.1%**, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored = 0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **ALL 48 dimensions refreshed** + `populate_hitter_run_values(2026)` ✓. The 3 `vs_top_hitters` aggregations that had failed on the gateway were completed over the DIRECT pg session (`--direct`). Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 ·
4,234 pitchers.** Prod must land within tolerance of this or **ABORT**.

## ⚠ STILL OPEN ON STAGING
- **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY.** Dry run: **0 hitters / 4,675 pitchers** would change
  (of 4,772 above-gate). It has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Review + apply step 5 (Masters) on staging.
2. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
3. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
4. Prod chain: reclassify → baseline → score → aggregate (**`--direct` from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the pitch_log lane.

## ⏱ PROD TIME BUDGET
Staging actuals: step 1 ≈ **75 min** (load + classify + 2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**
→ **staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already
times out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in **ONE sitting** with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split,
because a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (it re-scores everything matching the class version), so any interruption costs the FULL
runtime again. The two-phase fix (score only `stuff_plus IS NULL`, then ALWAYS recenter across the full population) is
worth building BEFORE the prod run — the recenter must see the whole population, which is why a naive resume is wrong.

---

# ✅ STEP 4 (`aggregate_pitch_log_dimensions`) — SOLVED: USE `--direct`. (staging-proven 2026-08-30)
**ROOT CAUSE CONFIRMED, not theorised.** Every aggregation in this script ran through `exec_sql` over the HTTP gateway
(`aggregate_pitch_log_dimensions.ts:1035`), and the gateway cuts the client at ~125s — the work is LOST.
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`, **reproduced EXACTLY twice**
(same dimension, same error, same duration). That query must resolve the top-quartile hitter set (~967 IDs) and filter
~2M pitches against it. Over the **DIRECT pg session the SAME query succeeded in 253.2s** — it simply needs ~2× the
gateway's ceiling; nothing else changed. 47 of 48 dimensions run fine (~60-72s each). ⚠ The script **HALTS** on a
failure, so dimensions 41-48 never ran either — one bad dimension blocked 9.

## THE COMMANDS
Staging (single dimension):
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
**PROD — run the WHOLE of step 4 with `--direct`, not just this dimension:**
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
`vs_top_hitters` already needs 253s on STAGING. Prod is a smaller compute tier with a more throttled disk (expect
~8-10 min for that one dimension) and prod's `exec_sql` has ALREADY been observed timing out on lighter queries →
through the gateway it would fail on prod **100% of the time**, and the halt would block the 8 dimensions after it.
**`--direct` is NOT a staging workaround — it is the REQUIRED path on prod.**

## FLAGS ON `aggregate_pitch_log_dimensions.ts`
- **`--direct`** (new 2026-08-30) — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling)
  instead of `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs the path used.
- **`--only=<keys>`** (new 2026-08-30) — mirrors `--skip=`; runs ONLY the named dimension(s), so one failed dimension can
  be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- **`--skip=<keys>`** (existing) — skip named dimensions.
- **`--prod`** guard + prod path (added at Stage 0).

## ⚠ THE TWO TRAPS — validate by CONTENT and FRESHNESS, never by exit code or row count
- **A failed dimension leaves STALE rows that LOOK populated.** When `vs_top_hitters` failed, `pitch_log_pitcher_totals`
  still SHOWED **5,349 rows** for that `dimension_key` — left over from a PRE-v2 run, computed from OLD labels and OLD
  Stuff+ scores. **A row-count check would have passed.** → After ANY reclassification, verify a dimension by
  FRESHNESS (did *this* run write it?), never by row count.
- **The script EXITS 0 even when a dimension FAILED.** → grep the log for `FAILED` and for the per-dimension `ok`.
  A run was wrongly marked COMPLETE this way on 2026-08-29.

## RESUMABILITY OF THE CHAIN (know what a restart costs)
| step | resumable? | why |
|---|---|---|
| 1 `reclassify_prod.ts` | ✅ FULLY | keyset on PK + `is distinct from` guards + `_reclass_fix` upserted by PK. A re-run skips completed rows. |
| 3 `compute_pitch_log_stuff_plus.ts` | ❌ NO — and it is the costliest to lose | re-scores ALL rows matching the class version instead of filtering `stuff_plus IS NULL`. Every attempt costs the FULL runtime (~36 min staging, longer on prod), and a mid-run failure leaves **v2 labels + STALE scores**. FIX (future): two phases — score only NULLs, then ALWAYS recenter the full population (the recenter must see everything to shift each bucket to mean 100). |
| 4 `aggregate_pitch_log_dimensions.ts` | ⚠ MANUALLY | the 48 dims are independent and `--skip=`/`--only=` exist, but you must pass the completed keys BY HAND. FIX (future): auto-skip dims already written for this run-generation. |

## ⚠ ENVIRONMENTAL FAILURES — do not confuse them with the gateway timeout
Three failures the same night were the LOCAL MACHINE sleeping / dropping its connection, NOT script defects:
staging insert `TypeError: fetch failed` · STEP 3 scoring died at 1,665,000/2,015,321 (~83%) with `read ECONNRESET` ·
STEP 4 first run died at 13/48, second at 39/48.
**Distinguishing symptom:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters` failure died
at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED and let them take however long they need,** with
`caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not add
aggressive retry loops.

---

## 🏆 PHASE-H CLEANUP — WHAT MUST NEVER BE DROPPED
Phase H lists the Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these — plus `team_war_snapshots`:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Now that we standardize on v2, this is the SOLE way to ever measure
  against the old process — the regression baseline for every future classifier change.
- **`_reclass_map` (37,101 rows)** — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- **`_reclass_pf` (4,804 rows)** — per-pitcher primary-FB velo (the v2 staging run materialized 5,364 rows of it).
- **`team_war_snapshots`** — holds prod's irreplaceable 2025 champions (309 rows). NEVER drop.
Safe to drop: **`_reclass_fix`** (transient writer staging table only).

---
# ⚠️ `--direct` SILENT HANG — statement_timeout=0 removes the CEILING but also the FAILURE SIGNAL (prod, 2026-08-30)
**What happened:** the prod stage-4 run stalled on `[41/48] vs_top_hitters → pitcher_by_pitch_type` and sat there for
**39 minutes with zero log output**. Diagnosis over a second connection: **NO active query on prod** (`pg_stat_activity`
showed only my own catalog lookup) and **0 ungranted locks** — so the database was doing nothing. The client process was
alive but waiting forever. The direct connection had dropped and the client never learned about it.

**ROOT CAUSE — a gap in the `--direct` fix shipped earlier the same day.** To defeat the HTTP gateway's ~125s cut we set
`statement_timeout = 0` and a very long `query_timeout`. That correctly removes the ceiling that made `vs_top_hitters`
impossible over `exec_sql` — but it ALSO removes the only signal that something died. A dropped pooler connection
therefore presents as an INFINITE HANG instead of an error, and nothing retries because nothing failed.

**FIX TO MAKE (not yet implemented):** on the `--direct` pg client set `keepAlive: true` with a keepalive delay, a
finite `query_timeout` sized to the slowest known dimension with headroom (staging `vs_top_hitters` 254.9s, prod 151.6s
→ e.g. 20-30 min, not 0), and per-dimension progress logging so a stall is visible in the log rather than only in
`pg_stat_activity`. `statement_timeout=0` on the SERVER side is fine; it is the CLIENT-side infinite wait that is wrong.

**HOW TO DETECT A STALL (do this, don't guess):**
1. Compare the log's mtime to now — no output for >2× the slowest dimension = suspect.
2. Query `pg_stat_activity` on a SEPARATE connection: if there is **no active query**, the client is hung, not slow.
3. Check `pg_locks where not granted` — 0 means it is not a lock wait either.
4. Also check for STALE PROCESSES from earlier runs (`pgrep -f aggregate_pitch_log`) — an old staging run was still
   alive and competing for connections.

**RECOVERY (safe — stage 4 is idempotent):** kill the hung + stale processes, then re-run. Prefer re-running the FULL
set on prod rather than cherry-picking with `--only`/`--skip`: dimension rows that already exist may be STALE from the
pre-v2 process, and "rows exist" does NOT mean "rows are fresh". Steps 1-3 are unaffected — do NOT redo them.
**Nothing was corrupted by this stall.**

---
# 🧭 TRACK B — EXECUTION LESSONS FROM THE FIRST REAL RUN (staging + prod, 2026-08-29/30)
The 5-step chain has now been run END-TO-END on BOTH environments. Track B automates exactly this chain on ingest,
so every failure mode below WILL recur unattended unless Track B is built to handle it. This section is the
requirements list, written from what actually happened — not theory.

## ✅ WHAT WORKED (keep these properties)
- **Per-pitcher classification is deterministic.** Prod and staging produced an IDENTICAL label distribution to the
  tenth of a percent (4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1) and an
  IDENTICAL per-pitcher Stuff+ gate (mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7). Two independent datasets, same
  numbers ⇒ the classifier + scorer are reproducible. **Track B should assert this gate after every run.**
- **A hard SIGN CHECK that refuses to write** caught nothing because nothing was wrong — but it is the reason we can
  TRUST the armHB convention on both envs (18/18 buckets, twice). **Keep abort-before-write invariants.**
- **`is distinct from` + keyset + per-batch commit** made step 1 resumable and cheap to retry.
- **Backups before every destructive step** (`_v2_prechain_backup`, `_hm_prestep5_backup`, `_pm_prestep5_backup`) made
  the whole chain reversible. **Track B must snapshot before it writes, every run.**
- **Halt-on-failure between steps** stopped a quoting bug from cascading (it died before writing anything).

## ❌ WHAT BROKE — AND WHAT TRACK B MUST DO ABOUT IT
1. **STEP 3 DOES NOT RESUME.** `compute_pitch_log_stuff_plus.ts:185` re-scores every row matching the class version
   rather than filtering `stuff_plus IS NULL`, so each attempt costs the FULL runtime (staging 35.7 min, prod 29.9)
   and a mid-run failure leaves **v2 labels + STALE scores** — the one state that must never exist.
   → **TRACK B FIX: two phases — (a) score only `stuff_plus IS NULL`, (b) ALWAYS recenter across the FULL population**
   (the recenter needs every row to shift each bucket to mean 100, which is why naive resume is wrong).
2. **`--direct` REMOVES THE FAILURE SIGNAL.** `statement_timeout=0` + long `query_timeout` defeats the gateway's ~125s
   cut (required: `vs_top_hitters` needs 151-255s) but a dropped pooler connection then becomes an INFINITE HANG.
   Prod stage 4 sat **39 minutes with no output**, no active query, no locks. Nothing retried because nothing failed.
   → **TRACK B FIX: `keepAlive: true`, a FINITE `query_timeout` (~20-30 min, sized off the slowest dimension), and
   per-dimension progress logging.** Unattended automation CANNOT have an unbounded wait.
3. **EXIT CODE 0 ≠ SUCCESS.** `aggregate_pitch_log_dimensions.ts` exits 0 even when a dimension FAILED, and it HALTS
   on that failure so the 8 dimensions behind it never run. A run was wrongly marked COMPLETE this way.
   → **TRACK B FIX: validate by CONTENT (grep for the per-item success line + `FAILED`), never by exit code.**
4. **"ROWS EXIST" ≠ "ROWS ARE FRESH".** When `vs_top_hitters` failed, its table still showed 5,349 rows from the
   PRE-v2 run. A row-count check PASSES on stale data.
   → **TRACK B FIX: stamp a run/version marker on aggregate rows and verify FRESHNESS, not count.**
5. **`select *` VIEWS GO STALE SILENTLY.** Prod's `pitch_log_corrected` was frozen at 94/99 columns and did not expose
   `classification_version`, so the scorer hard-failed on prod while passing on staging. `create or replace` cannot
   fix it — it needs drop+create.
   → **TRACK B FIX: after ANY `ALTER TABLE pitch_log ADD COLUMN`, rebuild the view. Assert the view's column count
   matches the base table before the chain starts.**
6. **A LABEL CHANGE INVALIDATES EVERYTHING BELOW IT.** The §4.5 gyro floor moved 6-8% of breaking-ball volume, so every
   mix-dependent baseline/SD/percentile was invalid until regenerated.
   → **TRACK B FIX: steps 1→5 are ONE transaction-of-work. Never emit "done" between them.**
7. **ORDERING IS LOAD-BEARING AND WAS WRONG IN THE DOCS.** C26 must follow C27 (it reads `ncaa_averages` and falls back
   to hardcoded defaults SILENTLY when fields are missing); C29 must precede C28 (10 NJCAA rows are still tagged
   `division='D1'` and both C28 producers filter on it). Migration order for `team_season_stats` is by DEPENDENCY, not
   timestamp — the filenames sort wrong and fn-before-ALTER empties the table.
8. **UNORDERED `.range()` SILENTLY DROPS/DUPES ROWS.** Found in 6+ producers. A blanket `order("id")` is NOT the fix —
   `pitch_log_*_totals`, `player_season_defense` and `player_season_baserunning` have NO `id` column.
   → **TRACK B FIX: per-table PK map; refuse to paginate an unregistered table.**
9. **NEW-ROW CREATION WAS UNGATED.** `derive_masters_from_pitchlog` spread invented Master rows into the same upsert as
   the patches. The Masters are the TruMedia source of truth; a pitch-log-only row is a half-populated player.
   → **TRACK B FIX: never create Master rows implicitly. Opt-in only (`--create-new`), default OFF.**
10. **ENV GUARDS WERE MISSING OR WRONG.** One market script hardcoded `.env.local` (would resync STAGING while
    reporting success on a prod run); two others had NO guard at all and would write prod with zero opt-in; one had a
    STAGING build-id as its default scope, returning 0 rows on prod.
    → **TRACK B FIX: double-keyed guard everywhere — the URL and the `--prod` flag must AGREE, or refuse to run.**
11. **SEASON KEYS DIFFER BY PURPOSE.** 2026 = completed season (descriptive WAR), 2027 = projections. A query on the
    wrong season returns a misleading ZERO — this produced a false "staging has no WAR data" alarm.
    → **TRACK B FIX: every gate query must state its season explicitly and assert a non-zero denominator.**
12. **MACHINE SLEEP KILLED LONG RUNS.** Distinguish: environmental failures die at a DIFFERENT point each run;
    structural ones die at the SAME place with the SAME duration. Run detached with `caffeinate -dimsu -w <pid>`.

---
# ✅ PROVEN ON PROD — THE STUFF+ CHAIN, WHAT IT PRODUCED, AND WHY IT IS CORRECT (2026-08-30)
The full 5-step chain has now run END-TO-END on BOTH environments. This is the record of what worked, the values it
produced, and the EVIDENCE that it is right — not just that it completed.

## THE RESULT — PROD AND STAGING AGREE ON INDEPENDENT DATA
| check | STAGING | PROD | verdict |
|---|---|---|---|
| pitches classified | 2,015,321 | 2,013,005 | both = every `is_data=true` row |
| label distribution | 4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1 | **IDENTICAL** | deterministic |
| needs_review | 8.1% | 8.1% | identical |
| per-pitcher Stuff+ | mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 | **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7** | identical |
| bucket recenter | every (type×hand) = 100.0 | every (type×hand) = 100.0 | correct by construction |
| unscored rows | 0 | 0 | full coverage |
| armHB sign check | 18/18 buckets | 18/18 buckets | convention PROVEN twice |
| Master avg stuff_plus | 98.82 | 98.86 | consistent |
**WHY THIS IS THE PROOF:** two DIFFERENT pitch populations, run through the same committed classifier + scorer,
produced the same distribution to the tenth of a percent AND the same per-pitcher percentiles. That cannot happen by
chance if anything upstream (labels, baseline, convention, recenter) were wrong. Independent replication, not a
self-check.

## THE VALUES IT USED (canonical; see the "TRACK B — EVERY VALUE THE CHAIN COMPUTES WITH" block)
Classifier v2 @ **95.2% per-pitch / 95.3% arsenal-mix** vs the anchor ground truth (full 2,000,674-pitch population).
Three shipped fixes, each MEASURED not guessed: offspeed **armHB floor = 5** (gyro p99 4.7 vs offspeed p1 5.3, a clean
empty gap) · **fastball-family merge guard** (91.69%→93.01%, 4S↔Sinker errors −41%) · **§4.5 gyro floor = −3 applied
BEFORE the backfill** (95.1%→95.2% AND fragmentation 7%→5%, strictly better on both). Two NEGATIVE results recorded so
they are never rebuilt: `rr > −1.7` and the "arsenal rule" (both lose ~1pp). Verified-optimal, do not touch:
Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5. **RPW = 13.1**, verified stored in BOTH envs'
`model_config` (`owar_runs_per_win` / `pwar_runs_per_win`) and present 4× in prod's live `refresh_composite_war()`.

## WHY EACH SAFEGUARD MATTERED (all of these fired or would have)
- **Abort-before-write sign check** — the reason armHB is TRUSTED on both envs rather than assumed.
- **Backups before every destructive step** (`_v2_prechain_backup` 2.58M/2.58M rows, `_hm_prestep5_backup` 30,025/30,027,
  `_pm_prestep5_backup` 29,238/29,239) — made the whole chain reversible; used to disprove a suspected regression.
- **Halt-on-failure between steps** — stopped a quoting bug before it wrote anything.
- **`--direct` for stage 4** — `vs_top_hitters` needs 151–255s and the HTTP gateway cuts at ~125s, so it would have
  failed 100% on prod AND halted the 8 dimensions behind it.
- **New-row creation gated OFF** — prevented inventing half-populated Master rows. Confirmed 0 new rows on both envs.
- **Phase-gate "value landed, not just ran"** — caught that `pull_air` went 0 → 4,366 on prod (C23 subsumed by C25).

## ⚠ THE THREE TRAPS THAT PRODUCED FALSE ALARMS (check these before reporting a problem)
1. **Season keys.** 2026 = completed/descriptive · 2027 = projections. Wrong season ⇒ misleading ZERO. Caused a false
   "staging has no WAR data" alarm.
2. **Different denominators.** A count across ALL seasons vs `Season=2026 AND division='D1'` are not comparable —
   this produced a false "trackman_pitches regression" (it was 0 before AND after; C24 populates it, and it had not run).
3. **"Rows exist" ≠ "rows fresh."** A failed aggregation leaves stale rows that PASS a count check.
**RULE: compare like-for-like against the BACKUP before calling anything a regression.**

---
# 🛑 C28 PRE-FLIGHT — FINDINGS (2026-08-30). RUN NOTHING UNTIL THESE ARE RESOLVED.
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against PROD. Three blockers found.

## ✅ LANE — CLEAN (both producers are on the correct lane)
`compute_conf_pitcher_env_plus.ts` reads `ncaa_averages` (refreshed by C27 ✅) + `"Pitching Master"` D1 WHIP/IP
(refreshed by C26 ✅) + `"Conference Stats"`. `derive_conf_opr_htp.ts` reads `"Park Factors".rg_factor` +
`"Conference Stats"` + `"Teams Table"`. **Neither touches the legacy `pitcher_stuff_plus_inputs`.** Also confirms the
C27-before-C26-before-C28 ordering is right: C28 consumes what both of those produced.

## 🔴 BLOCKER 1 — NEITHER PRODUCER HAS ANY `--prod` GUARD
`grep -c "trbvxuoliwrfowibatkm\|--prod"` = **0** for BOTH `compute_conf_pitcher_env_plus.ts` and
`derive_conf_opr_htp.ts`. `--env-file .env.production.local` writes PROD with **zero opt-in** — the same defect
already fixed in `_run_store_no_propagate.ts` (C26) and the four market scripts. **FIX BEFORE RUNNING:** add the
standard double-keyed guard (URL and `--prod` must AGREE) and verify the refuse path.

## 🔴 BLOCKER 2 — NO BACKUP EXISTS ON PROD, AND THE G-GATE REFERENCE DOES NOT EXIST EITHER
`_confstats_backup` = **ABSENT** on prod · `_confstats_backup_preassembly` = **ABSENT** on prod.
C28 is a DESTRUCTIVE rebuild of the conference baselines that every projection's competition-translation consumes.
**FIX: `create table _confstats_backup as select * from "Conference Stats"` on prod FIRST.**
⚠ The documented **G-GATE** (re-run bucketA on STAGING, diff vs `_confstats_backup_preassembly`, require 0.0000) has
**NEVER been executed** — it was deferred 2026-08-21 ("no staging conn"). The preassembly baseline it compares against
does not exist on prod, so the gate must be run on STAGING, where the artifact belongs.

## 🔴 BLOCKER 3 — `Park Factors.rg_factor_seasonal` IS EMPTY ON PROD (0/309) — SILENT-FALLBACK RISK
| | PROD | STAGING |
|---|---|---|
| Park Factors 2026 rows | 309 | 308 |
| `rg_factor` | **309 ✅** | 308 |
| `rg_factor_seasonal` | **0 ❌** | **308 ✅** |
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which IS populated on prod — so C28 will run. BUT prod is missing
the entire `*_seasonal` set that staging has (its producer, E2 `backfill_park_factors_seasonal.ts`, is hardwired to
STAGING and has never run on prod — audit G13/H4). **Decide BEFORE C28 whether the conference run-environment should
use the seasonal factors** (as staging effectively does downstream) or the flat `rg_factor`. If prod and staging use
different park inputs, their conference HTP/OPR will diverge and the staging-match gate becomes meaningless.

## CURRENT PROD STATE (what C28 is meant to fill)
`Conference Stats` 2026 = **42 rows** (D1 30 · NJCAA_D1 10 · D2 2 after C29) ·
**`hitter_talent_plus` 0/42** · **`run_env_factor` 0/42** ← C28 fills these · `Stuff_plus` **42/42** (pre-existing copy;
audit G14 notes D1 `Stuff_plus` has NO committed producer — confirm what refreshes it or it stays stale while
everything around it is rebuilt).

## ORDERED EXECUTION (only after 1-3 are resolved)
1. Add `--prod` guards to both producers; verify refuse paths.
2. `create table _confstats_backup as select * from "Conference Stats"` on PROD; verify row count = 42.
3. Run the **G-GATE on STAGING** (bucketA re-run vs `_confstats_backup_preassembly`, require diff 0.0000). ABORT if not.
4. Resolve the `rg_factor` vs `rg_factor_seasonal` decision.
5. PROD: **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor — **NEVER `--linked`** (`supabase/config.toml`
   currently names a THIRD project ref `kfkuhdmpchxyffmnowgj`; run `supabase projects list` first).
6. `compute_conf_pitcher_env_plus.ts --apply --prod` → `derive_conf_opr_htp.ts --apply --prod`.
7. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go 0/42 → populated; D1 stays 30 and NJCAA_D1 stays 10;
   conference Stuff+/HTP compare sanely to staging.
⛔ **NEVER run `populate-conf-stats` on prod** — it overwrites the hand-calibrated JUCO overlay. Different script,
confusingly similar name, not part of C28.

---
# 🧠 AGENT LEARNING — THE 5-QUESTION PRE-FLIGHT (validated 5 for 5 on 2026-08-30)
Before running ANY step of a multi-stage push, answer these five IN WRITING. Every single time it was applied it
found a real defect BEFORE the step ran, not after:
1. **LANE** — does it read the LIVE lane or a legacy one? (**C24** was summing the legacy `pitcher_stuff_plus_inputs`
   to set a user-facing leaderboard gate; the legacy source undercounted ~12.1 pitches/pitcher and agreed with
   pitch_log for only 11.9% of pitchers.)
2. **GUARD** — does it have a working double-keyed `--prod` guard? (**C26**'s runner had NONE and a banner claiming
   "staging" while it would write prod. **BOTH C28 producers have NONE.** Three market scripts had none. One
   hardcoded `.env.local` and would have resynced STAGING while reporting success on a prod run.)
3. **ORDER** — is its position right? (**C27 must precede C26**; **C29 must precede C28**; the `team_season_stats`
   migrations apply by DEPENDENCY, not by their timestamps, which sort WRONG.)
4. **SILENT FALLBACK** — does anything substitute defaults when an input is missing? (`computeAndStoreScores` falls
   back to HARDCODED baselines with no error — that is the entire reason C27 must run first.)
5. **BACKUP** — does a restore point exist? (**`_confstats_backup` does not exist on prod** and C28 is a destructive
   rebuild. The Masters had no backup before step 5 either — created one first.)
**The unifying insight: the dangerous failures all LOOK LIKE SUCCESS.** A legacy-sourced count, a guardless script
pointed at the wrong DB, a silent default substitution, a stale-but-populated table, an exit code of 0 with a failed
sub-step — none of them raise an error. The pre-flight is what converts them into visible decisions.

---
# 🔴→✅ CONFERENCE STUFF+ WAS ON THE LEGACY LANE — FIXED 2026-08-30 (critical for Track B)
## THE FINDING (audit G14 said "no committed producer" — that was WRONG)
`src/savant/lib/conferenceStuffPlusV2.ts` **IS** the producer of `"Conference Stats".Stuff_plus`. But it read
per-pitcher scored rows from **`pitcher_stuff_plus_inputs`** — the **LEGACY CSV lane**. The v2 chain writes Stuff+ to
`pitch_log.stuff_plus` and rolls it up to `"Pitching Master".stuff_plus`; it **NEVER writes PSP-I**, so PSP-I holds
**PRE-v2 scores**. Conference Stuff+ would therefore have been built from stale numbers.
**WHY THIS ONE MATTERS MOST:** Conference Stuff+ IS the competition-translation lever — a player projected INTO a
conference is scored against that conference's Stuff+/HTP. A stale value silently biases **every projection**.
This is the THIRD instance of the same shape (C24 `trackman_pitches`, `computeNcaaAverages` weighting, now this):
**the VALUE moved to the pitch_log lane but a supporting INPUT was left on legacy.**

## THE FIX
Read the rolled-up per-pitcher value and its pitch count straight from `"Pitching Master"`:
`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)` — definition unchanged (pitch-weighted,
full season). Both inputs are **pitch_log-sourced for D1** (C25 writes `stuff_plus`, C24 writes `trackman_pitches`)
and correctly **fall back to the legacy lane for JUCO**, so ONE formula stays right for BOTH divisions without ever
mixing lanes. Filters `stuff_plus IS NOT NULL AND trackman_pitches > 0`.

## VERIFIED ON STAGING (values are sane and the D1/JUCO relationship is correct)
`D1 30 conferences avg 99.16 (range 92.9–107.3)` · `NJCAA_D1 10 avg 96.00 (92.0–100.7)` · `D2 2 avg 93.00`.
D1 centring near 100 with JUCO clearly below it is the expected "conference pitching depth" signal.

## ⚠ GAP FOUND WHILE TESTING — `calculateConferenceStuffPlusV2` IGNORES `dryRun`
It was called with `{ dryRun: true }` and **wrote anyway** ("5. write to Conference Stats"). The option is not
implemented. Benign here (staging needed the refresh and the values are correct) but **there is no way to preview this
producer**. Before running it on PROD: either add real dry-run support, or rely on `_confstats_backup` (already created
on prod, 162 rows / 42 for 2026) as the rollback.
## TRACK B REQUIREMENT
Track B's conference-stats stage must compute Conference Stuff+ from the **pitch_log lane via Pitching Master**, never
from `pitcher_stuff_plus_inputs`, and must keep the D1 / JUCO fallback split intact.

---
# ✅ G-GATE EXECUTED AND PASSED (staging, 2026-08-30) — deferred since 2026-08-21, now done
Method: snapshot `"Conference Stats"` 2026 → `_ggate_before`, re-run `scripts/sql/conf_stats_bucketA_assembly.sql`,
then diff EVERY numeric column joined on `(conference_id, season)`.
**RESULT: 77 numeric columns compared · 0 changed · worst absolute diff 0.000000.**
✅ **The bucketA assembly is IDEMPOTENT** — re-running it does not drift values. Safe to run on prod.
(Reference table `_confstats_backup_preassembly` exists on staging: 162 rows, 42 for 2026.)

# 📊 PROD "Conference Stats" 2026 (D1, 30 rows) — WHAT IS FILLED vs WHAT C28 FILLS
**FILLED (66 cols):** AVG · OBP · ISO · ERA · FIP · WHIP · K9 · BB9 · HR9 · `Overall_Power_Rating` · `WRC_plus` ·
`ba_plus` · `ba_power_rating` · `Stuff_plus` · … (all inputs C28 needs are present)
**EMPTY (13 cols) — exactly C28's outputs, so there is NO partial state:**
`era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` ← `compute_conf_pitcher_env_plus`
`hitter_talent_plus` `run_env_factor` ← `derive_conf_opr_htp`
`OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score` ← bucketA assembly

## 🛑 STALE-VALUE CATCH — `Stuff_plus` IS 30/30 FILLED ON PROD **BUT IT IS PRE-v2**
The Conference Stuff+ lane fix was applied and verified on **STAGING only**. Prod's `"Conference Stats".Stuff_plus`
still holds the value computed BEFORE the v2 chain — a fully-populated column that PASSES any count check while being
stale. Third occurrence today of "looks populated, isn't fresh".
→ **C28 ON PROD NEEDS ONE MORE STEP THAN THE DOCS LIST:** run the FIXED `conferenceStuffPlusV2`
(`Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`) to refresh `Stuff_plus` from the pitch_log
lane, ALONGSIDE the two producers that fill the 13 empty columns. Otherwise the competition-translation lever stays
stale while everything around it is rebuilt.
→ Staging reference after the fix: D1 30 conf avg **99.16** (92.9–107.3) · NJCAA_D1 10 avg **96.00** · D2 2 avg 93.00.

---
# 🧩 C28 BUCKET MAP — WHO WRITES WHAT, AND WHY `Stuff_plus` FELL THROUGH THE GAP (2026-08-30)
`scripts/sql/conf_stats_bucketA_assembly.sql:12` states the split verbatim:
`SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/…)`

| bucket | producer | columns it writes |
|---|---|---|
| **A** | `conf_stats_bucketA_assembly.sql` (PASTE in SQL editor) | `OBP` `ISO` `SLG` `OPS` `obp_plus` `slg_plus` `iso_plus` `WHIP` `FIP` `ERA` + rates + `WRC_plus` |
| **B (pitching env+)** | `compute_conf_pitcher_env_plus.ts` | `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` |
| **B (OPR/HTP)** | `derive_conf_opr_htp.ts` | `run_env_factor` `offensive_power_rating` `hitter_talent_plus` |
| **B (Stuff+)** | ⚠ **`conferenceStuffPlusV2.ts` — a SEPARATE producer, NOT part of the documented C28 steps** | `Stuff_plus` |

## ★ THE GAP, STATED PLAINLY
`Stuff_plus` belongs to **Bucket B** but is written by **NEITHER** bucketA **NOR** `derive_conf_opr_htp`. It has its own
producer that the C28 runbook never listed. So:
**`Stuff_plus` is the ONLY Conference Stats metric that is BOTH (a) stale on prod (pre-v2) AND (b) not refreshed by any
of the three documented C28 steps.** Every other filled column is either rewritten by Bucket A / Bucket B, or is a
source input already refreshed by C24 / C26 / C27.
Because it is 30/30 populated it PASSES every count check while being stale — and it is the competition-translation
lever, so a stale value silently biases EVERY projection of a player INTO a conference.

## ✅ C28 ON PROD — THE CORRECTED FOUR-STEP ORDER (the runbook had three)
0. **Backups already created on prod:** `_confstats_backup` (162 rows / 42 for 2026) · `_parkfactors_backup` (615).
1. **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor. ⛔ **NEVER `--linked`** — `supabase/config.toml`
   names a THIRD project ref (`kfkuhdmpchxyffmnowgj`). Run `supabase projects list` first.
   ✅ **G-GATE PASSED 2026-08-30** — re-run on staging diffed 77 numeric columns: **0 changed, worst 0.000000**, so the
   assembly is IDEMPOTENT and cannot drift prod's values.
2. `npx tsx --env-file=.env.production.local scripts/compute_conf_pitcher_env_plus.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
3. `npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
   Reads `"Park Factors".rg_factor` — **309/309 populated on prod** (it does NOT read `rg_factor_seasonal`, which is
   empty on prod; that is E2's job and NOT a C28 blocker).
4. **★ NEW STEP — refresh `Stuff_plus`:** run the FIXED `conferenceStuffPlusV2`
   (`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)`).
   ⚠ **It IGNORES `dryRun` and writes regardless — no preview exists.** Rollback = `_confstats_backup`.
⛔ **NEVER run `populate-conf-stats` on prod** — different script, confusingly similar name, overwrites the
hand-calibrated JUCO overlay.

## PHASE GATE AFTER C28 (verify VALUES, not just that it ran)
- The 13 previously-EMPTY columns become populated: `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus`
  `hitter_talent_plus` `run_env_factor` `OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score`.
- `Stuff_plus` CHANGES from its stale pre-v2 value (compare BEFORE/AFTER — do not just count non-nulls).
- Division split holds: **D1 = 30 · NJCAA_D1 = 10 · D2 = 2**.
- Staging reference shape after the same fix: D1 avg **99.16** (92.9–107.3) · NJCAA_D1 avg **96.00** · D2 avg 93.00.

---
# ✅ C28 APPLIED TO PROD 2026-08-30 — all four steps, phase gate PASSED
Ran via the DIRECT pg session with the prod ref asserted (equivalent to pasting; **never `--linked`**).
BEFORE snapshot kept as `_c28_before` (alongside `_confstats_backup`).
1. **bucketA assembly** → `OPS` `SLG` `slg_plus` 0/30 → **29/30**
2. **`compute_conf_pitcher_env_plus --apply --prod`** → **30 conf rows**, 0 skipped.
   SANITY (correct direction): SEC ERA 5.82 → era+ **105** · Ivy 5.20 → **117** · HR9 SEC 1.62 → hr9+ **68**
   (SEC allows more HR ⇒ env+ <100) · Ivy 0.70 → **156**.
3. **`derive_conf_opr_htp --apply --prod`** → **30 rows**. e.g. Big 12 HTP 120.4 → **121** · MWC 98.8 → 97.8.
4. **★ `conferenceStuffPlusV2` (FIXED lane)** → **31 rows written**.

## ★ THE `Stuff_plus` CATCH WAS REAL — this is why step 4 exists
**D1 `Stuff_plus`: 101.17 → 99.15, with 30/30 rows CHANGED.** Prod now matches staging's **99.16**.
Following the runbook's three steps would have left it at the stale pre-v2 **101.17** while everything around it was
rebuilt — and a count check would have shown **30/30 populated and PASSED**. Because Conference Stuff+ is the
competition-translation lever, that stale value would have silently biased EVERY projection of a player into a conference.
Division relationship holds and matches staging: **D1 99.15 · NJCAA_D1 96.00 · D2 93.00**.

## PHASE GATE RESULT (D1, all were 0/30 before)
`era_plus 30` `fip_plus 30` `k9_plus 30` `whip_plus 30` `hitter_talent_plus 30` `run_env_factor 30` ✅
`OPS 29` `SLG 29` ⚠ · `pitcher_ev_score 0` ⚠

## ⚠ TWO LOOSE ENDS — NOT resolved, do not assume benign
1. **`OPS`/`SLG`/`slg_plus` = 29/30**, one conference short. Probable cause: a conference with no qualifying hitters,
   but **UNVERIFIED**. Identify the missing conference before trusting conference hitting rates for it.
2. **`pitcher_ev_score` = 0/30 and `pitcher_iz_score` likewise** — listed as bucketA outputs but bucketA did NOT fill
   them. Either they have a different producer or a precondition is unmet. **Find the producer before Phase F**, since
   these feed pitcher-side conference context.

---
# 🔍 C28 LOOSE ENDS — INVESTIGATED AND RESOLVED (2026-08-30)
Method: compare PROD against STAGING (which had already run C28) rather than reasoning from prod alone. This settled
all three in minutes — **always diff the two environments before theorising.**

## 1. ✅ `OPS`/`SLG`/`slg_plus` = 29/30 — EXPECTED, NOT A DEFECT. The missing conference is **Independent**.
```
PROD    — D1 conferences with NULL OPS: Independent
STAGING — D1 conferences with NULL OPS: Independent   (identical)
```
Independents have no conference-mates, so the conference hitting aggregate has nothing to pool. **29/30 is CORRECT on
both environments** — do NOT "fix" this. (Consistent with the existing rule that Independents are handled by
faced-competition Stuff+/HTP rather than conference pooling.)

## 2. ✅ `pitcher_ev_score` / `pitcher_iz_score` = 0/30 — NOT deprecated, NOT a prod gap. **Their producer has never run.**
Empty on **BOTH** prod and staging, so it is not something C28 broke. ⚠ I nearly recorded them as dead columns
superseded by `pitcher_ev90_score` / `pitcher_iz_whiff_score` — **that was WRONG.**
**They have a real producer: `src/savant/lib/conferenceScoutingAverages.ts`**, which WRITES them at `:453` / `:455`
(`pitcher_ev_score: round1(psEV)`, `pitcher_iz_score: round1(psIZ)`) and reads them back at `:520-522`.
→ **ACTION: run `conferenceScoutingAverages` for 2026 to fill them.** It has never been run for this season on either
environment. Pitcher EV mirrors hitter EV and is expected to be populated.

## 3. ★ PROD IS NOW AHEAD OF STAGING on the raw conference pitcher metrics
| column | PROD | STAGING |
|---|---|---|
| `pitcher_ev90` | **30/30** | 0/30 |
| `pitcher_exit_velo` | **30/30** | 0/30 |
| `pitcher_in_zone_pct` | **30/30** | 0/30 |
| `pitcher_iz_whiff_pct` | **30/30** | 0/30 |
| `pitcher_ev90_score` · `pitcher_iz_whiff_score` | 30/30 | 30/30 |
The C28 run filled these on prod; staging never had them. **CONSEQUENCE: staging is no longer a valid reference for
these columns** — do not treat a prod/staging mismatch here as a prod defect. Staging needs C24/C26/C27/C29 + this C28
pass applied to catch up (it only ever received the Stuff+ chain and the Conference Stuff+ lane fix).

## 🧠 LESSON
Two of the three "problems" were not problems, and the third was nearly mis-diagnosed in the opposite direction
(calling a live-but-unrun column deprecated). **Diff the environments FIRST, then grep for a producer, and only then
conclude.** A column being empty means one of: (a) expected/no data to pool, (b) its producer has not run, or
(c) genuinely dead — and those are indistinguishable from the fill count alone.

---
# ✅ C28b — CONFERENCE SCOUTING AVERAGES RUN (prod, 2026-08-30). `pitcher_ev_score` 0/30 → 30/30
**WHY:** `pitcher_ev_score` / `pitcher_iz_score` were 0/30 on **BOTH** prod and staging. They are **NOT deprecated** —
`src/savant/lib/conferenceScoutingAverages.ts` writes them at `:453` / `:455` and reads them at `:520-522`. The
producer had simply **never been run for 2026 on either environment**.
**NEW RUNNER:** `scripts/run_conference_scouting_averages.ts` — the library function had no env guard and no runner
existed, so the runner carries the standard double-keyed guard (URL and `--prod` must AGREE). Refuse path verified:
`✗ URL is PROD but --prod was not passed — refusing.`
**PRE-FLIGHT (all five, before running):** LANE ✅ reads `ncaa_averages` (C27) + the Masters (C25/C26), no legacy PSP-I ·
PAGINATION ✅ `fetchAll` already orders by `source_player_id` · ORDER ✅ needs `ncaa_averages`, C27 done · SILENT
FALLBACK ✅ **none** — it errors explicitly ("run Compute NCAA Averages first") if baselines are missing ·
BACKUP ✅ `_confstats_backup` (162 rows) + `_c28_before`.
**RESULT ON PROD (verified in the DB, not from the log):** `pitcher_ev_score` **30/30, avg 53.22** ·
`pitcher_iz_score` **30/30**.
⚠ **The console printed `conferences computed: 0` while successfully writing 30 rows** — my runner reads the wrong
field off the report object. Harmless, but a reminder of the standing rule: **verify in the database, never from the
log line.** (Fix the field name if this runner is reused.)
⬜ **STAGING still has these at 0/30** — run the same command there (without `--prod`) when catching staging up.

---
# 🗺️ PHASE D (dWAR / bsrWAR) — INVESTIGATION + PLAN (2026-08-30). Read before running anything.
Phase D is **entirely a season-2026 (descriptive) operation** and is **INDEPENDENT of Phases C, E and F** — D31/D32
take their constants from LOCAL JSON fixtures (`RPW 13.1`, E2T, replacement RA9, wOBA weights), NOT from `model_config`
/ `ncaa_averages` / `Conference Stats`. Nothing Phase C produced is an input here. It can run now.

## 🛑 THE ONE HARD BLOCKER — `team_war_snapshots.team_drs` DOES NOT EXIST ON PROD
`populate_descriptive_war.mjs:76` reads `team_war_snapshots(source_team_id, team_drs)`; the error branch at `:65` is
`process.exit(1)`. **D31 dies before writing a single row** (no partial-write risk, but it will not run).
🛑 **CORRECTION 2026-08-30 (late) — MY EARLIER "just paste `scripts/sql/team_drs_store.sql`" INSTRUCTION WAS WRONG AND IS REVERTED.** I was only supposed to reorder the steps, not change WHAT they do. The documented process — which predates this session and stands — is to **REGENERATE the value on prod, never copy it**:
- `AGENT_LEARNINGS_stuff_plus_2026_08_16.md:802-803`: *"regenerate team_drs via `scripts/drs/derive_team_drs.mjs` if needed. **PROD: run against PROD `team_war_snapshots`**"*
- `PROD_PUSH_BULLETPROOF_CHECKLIST.md` row **D2**: *"Run team_drs producer against prod … (FIX: add `--prod` + env guard)"*, gate **308 D1 rows sum ~0**
- `AGENT_LEARNINGS:859,:869` list **`team_drs_store.sql` under "script writers to RETIRE"** — it is a FROZEN SNAPSHOT of a computation, not the computation. Pasting it into prod is exactly the copy-instead-of-derive the project rule forbids ([[feedback_derive_over_copy]]).
**WHAT `derive_team_drs.mjs` ACTUALLY COMPUTES** (`:1-9`, B-R method): per-team `Σ drs_floor` from `player_season_defense`, grouped to a team via the Masters' `TeamID`, then **innings-weighted centering per division** — `team_drs = Σdrs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP`, so `dRS_behind(pitcher) = team_drs × pitcher_IP / team_IP` and Σ over all pitchers = 0 exactly.
**THE FIX THE DOCS CALL FOR (code, not data):** `:13` reads `./.env.local` only — no `SUPABASE_URL` fallback, no `--prod`. Add the standard double-keyed guard. ⚠ It also has **three unordered `.range()` loops** (`:15`, `:17`, `:22`) which on prod page over the Masters (30,025 rows ≈ 31 pages) and `player_season_defense` (13,454 ≈ 14 pages) — dropped rows silently understate a team's `Σ drs_floor`. Both must be fixed before the prod run.
⚠ **OPEN, NOT RESOLVED:** a read-only check on 2026-08-30 found prod's own data and staging's stored values agree for 303/308 teams (mean |Δ| 0.124) but differ on **Arkansas: 32.800 vs 41.060 (Δ −8.26)**. Which is correct is **UNDETERMINED** — prod's `players` table is LARGER (31,467 vs 15,561) — but that is **HISTORICAL DEPTH going back multiple years, NOT a discrepancy** (Trevor, 2026-08-30). Do not read it as prod being more complete for 2026. **Do not reconcile prod TO staging.** Run the producer on prod, sum per player under the team, and then investigate the difference on its own merits.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` carries multiple years of HISTORICAL rows — 31,467 vs 15,561 — which is expected, not a discrepancy). **D30 is a no-op re-run — dry-run to confirm, then skip.**
- **All 23 Master target columns EXIST on prod** (`woba, wraa, desc_owar, d_war, bsr_war, total_desc_war` + `_reg`
  variants; `desc_ra9, desc_fip_ra9, drs_behind, desc_pwar, total_desc_war` + `_reg`). **No Master DDL needed.** All are
  currently 0-populated on prod — that is what Phase D fills.
- All input CSVs/JSON exist on this machine. ⚠ **They are NOT in git** (`scripts/drs/.gitignore` ignores `output/`;
  `docs/drs-reference/.gitignore` ignores `*.csv`) — **Phase D can only be run from this machine.**
- Run from the **repo root** (`node scripts/drs/populate_descriptive_war.mjs`), never `cd scripts/drs` — the scripts mix
  `output/…`, `scripts/drs/output/…` and `docs/drs-reference/…` relative paths.

## ⚠ FIX BEFORE RUNNING
1. **D31 sort key is under-specified.** `populate_descriptive_war.mjs:62` maps `player_season_defense → "player_id"`, but
   `player_id` is NOT unique there (**9,268 distinct over 13,454 rows**) so ties can shuffle across the 14 page
   boundaries. Real PK is `(player_id, season, position)`. Mirror `src/lib/computeNcaaAverages.ts:184-185` exactly.
   (The 2026-08-30 fix got the hard-error half right — neither table has an `id` column — but left the tie half open.)
   Impact is second-order: a handful of wrong `d_war` values, not a hard failure.
2. **🛑 KILL `scripts/load-drs-wsb-prod.ts`** — a STALE DUPLICATE of the loader that never received commit `af89611`'s
   ordered-pagination fix (`:38` is still bare `.range()`), has **no `--dry-run`**, and is named for prod. It sits one
   tab-completion from the correct script. Delete it or reduce it to a shim.

## ▶️ ORDERED SEQUENCE
```
D29b (NEW)  DERIVE team_drs ON PROD — the documented producer, NOT a paste.
            (a) add the double-keyed --prod guard + ordered pagination to scripts/drs/derive_team_drs.mjs
            (b) alter table team_war_snapshots add column if not exists team_drs numeric;   (DDL only)
            (c) run the producer against PROD; it prints the storage SQL for its OWN derived values
            GATE: 308 D1 rows, Σ centered = 0 per division (the script asserts this itself), then
                  select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;
            ⛔ do NOT paste scripts/sql/team_drs_store.sql — it holds STAGING's frozen values and is
               listed for retirement. Then tick PROD_MIGRATIONS_TODO.md:234.
D30         npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
            EXPECT "13454 would upsert, 11 unresolved" / "10432 would upsert, 30 unresolved" → then SKIP the apply.
            ⛔ NEVER scripts/load-drs-wsb-prod.ts
D31         node scripts/drs/populate_descriptive_war.mjs --prod          (dry-run first, from repo root)
            GATE vs staging (2026 D1): desc_owar mean 0.3456 · d_war mean 0.0103 · bsr_war mean 0.0000 ·
            total_desc_war mean 0.3559 · HITTERS ~5,340 · PITCHERS ~5,375.
            ★ Confirm `drs_behind` is NOT all-zero in the SPOT block — all-zero means D29b did not take.
            then: node scripts/drs/populate_descriptive_war.mjs --prod --commit
            ⚠ ~10,715 individual PostgREST UPDATEs at pool 24 (:151-163), several minutes, NO transaction.
              A mid-run failure leaves a partial write; re-running is safe (pure recompute keyed by source_player_id+Season).
D32         node scripts/drs/populate_descriptive_war_reg.mjs --prod      (dry-run, then --commit)
            ★★ HARD-ORDER: MUST follow D31's commit. It reads `Pitching Master.drs_behind` (:79) and `num(NULL) → 0`,
               so running it early produces WRONG desc_ra9_reg / desc_pwar_reg with **NO error**. Verify
               drs_behind = 5,375/5,375 non-null on prod FIRST.
            GATE: staging has 5,322/5,343 hitter _reg and 5,372/5,377 pitcher _reg — the ~20 shortfall is players absent
            from hitter_accrued.csv, expected.
D33         ⛔ FOLDED INTO D29b — this IS the team_drs producer (`derive_team_drs.mjs`), so by DATA
            ORDER it must run BEFORE D31 (which reads `team_war_snapshots.team_drs`), not last.
            My earlier "SKIP — CSV only" note was wrong in substance: the CSV is a by-product, and the
            script also PRINTS the team_war_snapshots storage SQL (`:8`). It needs the --prod guard and
            the 3 unordered .range() loops fixed first.
D34         VERIFY on prod, 2026, division='D1':
            d_war / bsr_war / desc_owar / total_desc_war = 5,340 non-null each ·
            desc_pwar / desc_ra9 / drs_behind = 5,375 each · avg(d_war) ≈ 0.010 · avg(bsr_war) ≈ 0.000 ·
            avg(desc_owar) ≈ 0.346 · max|total_desc_war − (desc_owar+d_war+bsr_war)| ≤ 0.002 ·
            drs_behind range ≈ −5.24 … 6.48 with ~11 exact zeros.
```

## 📄 DOC CORRECTIONS FROM THIS INVESTIGATION
- **F39 is described wrongly in the runbook.** `refresh_composite_war()` on prod (read via `pg_get_functiondef`) updates
  **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the Masters**. So it does NOT overlap D31's
  Master writes, and the accidental 2026-08-30 invocation left `Hitter Master.d_war` at 0/5,340 (confirmed).
- **`regular_season_pa` / `regular_season_ip` are 0-populated on prod** (staging 5,339/5,343 and 5,374/5,377). NOT a
  Phase D blocker — D32 selects but never reads them (its reg counts come from CSVs). Producer is
  `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026"). Will bite a later phase.
- **`team_season_stats` is 0 rows on prod** (staging 308 for 2026). Filled in Phase F by `refresh_team_season_stats(2026)`,
  whose step 6 carries `team_drs` across from `team_war_snapshots` — so D29b also unblocks that later carry.

---
# 🔁 DOC-vs-REALITY SWEEP (2026-08-30, late) — re-probed prod directly. FOUR 🛑 BLOCKERS ARE STALE, ONE IS NEW.
Method: direct pg session against the prod ref + `grep -c` on each named script. **Verified, not asserted.**
Every 🛑 in these docs was re-checked against the live database and the current file, because several were written
BEFORE the fixes that resolved them and a stale blocker is as expensive as a missed one.

## ✅ STALE — these 🛑 blockers are RESOLVED. Do not re-do this work.
| doc claim | reality on 2026-08-30 |
|---|---|
| **F44 / step 10a: "`team_season_stats` does not exist, 3 migrations unapplied, CANNOT RUN TODAY"** | **table EXISTS + `refresh_team_season_stats` fn EXISTS** (`pg_proc` = 1). The 3 migrations were applied in DEPENDENCY order as Phase-C prereqs. Table is **0 rows** — that is F44's job, not a blocker. **F44 is RUNNABLE.** |
| **G46: "blocked — `team_season_stats` missing"** | Same. The gate is now only "F44 has RUN and populated it", not "the table must be created". |
| **F42: "`resync-build-snapshot-markets.ts:17` is hardcoded to `.env.local`, will silently write STAGING"** | **FIXED.** The file header now documents the old defect and it is env-driven (`process.env` first, env-file fallback) with a **double-keyed guard**. **F42's first half is runnable.** |
| **F41: "`rebake-twp-markets.ts` / `fix-returner-twp-hitter-market.ts` have no `--prod` flag and no ref assert"** | **FIXED.** Both now `grep -c trbvxuoliwrfowibatkm` = 1 with `--prod` handling. Still invoke them directly (not npm scripts) — that half of the note stands. |
| **D30: "`load-drs-wsb-staging.ts:53` unordered `.range()` over `players`"** | **FIXED** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending. The comment documenting why is in the file. |

## 🔴 NEW BLOCKER — `scripts/run-twp-recompute.ts` (step E35) HAS NO ENV GUARD AT ALL
`grep -c 'trbvxuoliwrfowibatkm'` = **0** and `grep -c -- '--prod'` = **0**. E35 is the **FIRST** step of Phase E and it
**sets `is_twp` + primary `position` on `players`** — a write to the identity table that every downstream precompute
keys off. `--env-file .env.production.local` writes PROD with **zero opt-in**, and passing `--prod` does nothing.
This is the SAME defect already fixed in `_run_store_no_propagate.ts` (C26), both C28 producers, and the four market
scripts — **the fifth instance of it.** ⚠ Prod `is_twp` = **137/31,467** vs staging's 253, so this step genuinely has
work to do on prod and WILL be run. **Add the standard double-keyed guard and verify the refuse path before Phase E.**

## 🔴 STILL OPEN — `backfill_park_factors_seasonal.ts` (E2) is unguarded AND staging-hardwired
`grep -c` = **0 / 0**. Prod `"Park Factors"` 2026 = **309 rows · `rg_factor` 309/309 ✅ · `rg_factor_seasonal` 0/309 ❌**
(staging 308/308). Confirms audit G13/H4: the producer has never run on prod. **Not a C28 blocker** (C28 reads
`rg_factor`, which is full) — but it must be guarded + re-pointed before E2, and F44/G46 consume park-derived values.

## 📊 PROD STATE PROBED DIRECTLY (2026-08-30) — the numbers Phase D/E/F start from
```
team_season_stats           EXISTS, 0 rows        refresh_team_season_stats()  EXISTS
team_war_snapshots.team_drs COLUMN ABSENT  ← the Phase D hard blocker (D29b)
"Park Factors" 2026         309 · rg_factor 309 ✅ · rg_factor_seasonal 0 ❌
"Hitter Master"   2026 D1   5,340 · d_war 0 · desc_owar 0 · total_desc_war 0   ← Phase D fills
"Pitching Master" 2026 D1   5,375 · drs_behind 0 · desc_pwar 0                 ← Phase D fills
players                     31,467 · is_twp 137   (staging 253)                ← E35 fills
customer_teams active       14  ✅ (NOT 18 — that is a staging number)
player_predictions 2027     200,754 rows (pre-existing; Phase E regenerates)
```
★ **`Hitter Master.d_war` = 0/5,340 is independent CONFIRMATION that the accidental `refresh_composite_war()` did NOT
touch the Masters** — it writes `player_predictions`. The runbook's F39 description is wrong; see the Phase D block.

## 🧠 LESSON — RE-PROBE BEFORE TRUSTING A 🛑 YOU WROTE YESTERDAY
Four blockers were already fixed and one brand-new one was sitting unflagged in the very next phase. A 🛑 records the
state at the moment it was written; it is **not** a live indicator. **Re-run the check, then act.** The 5-question
pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has now found a real defect before **every** step it has
been applied to — C24 (legacy lane) · C26 (no guard, lying banner) · C27 (wrong order) · C28 (no guards on either
producer, no backup) · C28b (no runner at all) · Conference Stuff+ (legacy lane) · D31 (sort key) · **E35 (no guard)**.

---
# 📌 TWO DECISIONS LOCKED (Trevor, 2026-08-30)
## 1. STAGING CATCH-UP HAPPENS **AFTER** THE PROD PUSH — and it will be run **THROUGH TRACK B**
Staging is missing C24 / C26 / C27 / C28 / C28b / C29. It is **deliberately** not being caught up first.
**Consequence to hold onto:** for the columns prod has and staging does not (`pitcher_ev90`, `pitcher_exit_velo`,
`pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`, and the conference `*_plus` set), **staging is NOT a valid reference**.
Do not treat a prod↔staging mismatch as a prod defect without first checking which environment is behind.
★ **The catch-up is not a manual re-run of six scripts — it is the FIRST REAL EXERCISE OF TRACK B.**
## 2. `rg_factor_seasonal` **MUST** BE FILLED (not deferred) → E2 is a required step. See the E2 block.
## ★ WHY TRACK B IS THE POINT — the target operating model
**Track B is ONE edge function that runs ONCE PER DAY and performs the entire upload + store chain.** Everything in
this push that is a hand-run script becomes a stage inside that single daily run. That is why **every finding, lane,
order dependency, silent fallback and gate in these documents gets logged into
`docs/PIPELINE_pitch_log_to_projections.md` in full detail** — that document is the SPECIFICATION Track B is built
from, and the prod push is the dress rehearsal for it.
**Every defect found in this push is a requirement for Track B**, because a daily automated run has no human to
notice that a column is "populated but stale":
- the value/input LANE SPLIT (pitch_log vs legacy PSP-I) — 3 occurrences, all invisible to count checks
- ORDER dependencies where a stale input yields wrong numbers with **NO error**: C27→C26 · C29→C28 · D31→D32 ·
  E35→precomputes · **E2→`derive_conf_opr_htp`** (found 2026-08-30)
- SILENT FALLBACKS: hardcoded defaults for missing baselines, `num(NULL) → 0`, a version filter that matches 0 rows
  and exits 0
- destructive delete+reinsert stages that need a backup and a **row-level** (not count-level) gate
**Rule for Track B: a stage is not "done" because it ran. It is done when a stage-specific VALUE gate passes.**

---
# 🅴2 PARK FACTORS SEASONAL — DECISION: **MUST BE FILLED** (Trevor, 2026-08-30). And it FORCES A C28 RE-RUN.
`rg_factor_seasonal` is **0/309 on prod** vs 308/308 on staging. Trevor: **"rg factor seasonal 100% has to be filled."**
So E2 is a REQUIRED step, not the deferral the docs assumed. Investigating it turned up **four** things, one of which
is an ordering dependency that no doc records.

## 🔴 1. THE ORDERING BOMB — **E2 INVALIDATES C28's OPR/HTP OUTPUTS. `derive_conf_opr_htp` MUST BE RE-RUN AFTER E2.**
`backfill_park_factors_seasonal.ts:274` writes the **MAIN** factor columns too, not just `*_seasonal`:
`avg_factor, obp_factor, iso_factor, rg_factor, whip_factor, hr9_factor` + the lhb/rhb set. For the CURRENT season it
sets them to the **3-YEAR ROLLING** mean (2024/25/26), not the single season (`:267` `isCur ? rolling : sf`).
**`derive_conf_opr_htp.ts:10` reads `"Park Factors".rg_factor`** — and C28 step 3 ALREADY RAN on prod against the
*current* `rg_factor`, producing `run_env_factor` **30/30 (avg 101.879)** and `hitter_talent_plus` **30/30**.
E2 changes `rg_factor` underneath them ⇒ **both silently go stale**, and `HTP = OPR + 1.25·(Stuff+−100) + 0.75·park`
is the **competition-translation lever** — the exact same blast radius as the Conference Stuff+ catch.
★ **THEREFORE: after E2 applies, RE-RUN `derive_conf_opr_htp.ts --apply --prod` (C28 step 3).** It is idempotent and
cheap. A count check will show 30/30 and PASS either way — this is the **fourth** "populated but not fresh" trap of
this push. Log the BEFORE/AFTER `run_env_factor` values and require them to CHANGE.
(⚠ If E2 is instead run BEFORE C28 in some future ordering, C28 step 3 simply consumes the new value and no re-run is
needed. The rule is: **`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.**)

## 🔴 2. IT IS A DESTRUCTIVE DELETE + REINSERT OF THREE WHOLE SEASONS — not an upsert
`:285-288` `await sb.from("Park Factors").delete().eq("season", y)` for **each of 2024, 2025, 2026**, THEN inserts
(`:291`). There is **no upsert and no transaction** — a failure between the delete and the insert leaves Park Factors
**EMPTY for those seasons**, which takes conference HTP and every park-adjusted projection with it.
**PROD TODAY:** `2025 → 306 rows` · `2026 → 309 rows` · **no 2024 rows at all** (E2 CREATES the 2024 season on prod).
✅ **`_parkfactors_backup` exists on prod = 615 rows = exactly 306 + 309.** Restore point confirmed complete.
⚠ **ROW-COUNT GATE:** the reinsert only writes teams present in the CSVs. Prod 2026 has **309** rows and staging has
**308** — so at least one prod team may NOT come back. **Diff the team list BEFORE/AFTER and account for every dropped
row by name** before accepting the run. Do not gate on "it inserted lots of rows."

## 🔴 3. HARDCODED TO STAGING — `--env-file` CANNOT REDIRECT IT (same defect class as the old F42)
`:37` `const url = "https://slrxowawbijbjrkozqlj.supabase.co";` — a **literal staging URL** — and `:38-39` reads the
**literal string `.env.local`** for the service key. `grep -c 'trbvxuoliwrfowibatkm'` = **0**, `grep -c -- '--prod'` = **0**.
Running it "on prod" today would **silently rewrite STAGING's Park Factors and report success.**
**FIX BEFORE RUNNING:** make it env-driven (`process.env` first, env-file fallback) + the standard double-keyed guard,
copying the pattern now in `scripts/resync-build-snapshot-markets.ts`. Verify BOTH refuse paths.

## ⚠ 4. MACHINE-LOCAL FIXTURES — like Phase D, this can only be run from this machine
`:33` `ROOT = "/Users/danielleogonowski/RSTR IQ Data/park-factors"` — outside the repo, not in git.
✅ **VERIFIED PRESENT: `2024/`, `2025/`, `2026/`, 6 CSVs each** (combined/lhb/rhb × hitter/pitcher).

## ▶️ E2 ORDERED SEQUENCE
```
E2a  Add the double-keyed guard + env-driven URL/key to backfill_park_factors_seasonal.ts. Verify both refuse paths.
E2b  DRY RUN on prod. It prints "2026 rolling vs existing" mean|Δ| / max|Δ| / worst-8 per metric (:247-254).
     ★ READ THAT DIFF — it is telling you exactly how much C28's run_env_factor is about to move.
     Record the 2026 team list; diff vs the 309 prod rows and name every team that would not be reinserted.
E2c  Confirm _parkfactors_backup = 615 (done ✅). APPLY.
     GATE: rg_factor_seasonal 309/309 (was 0/309) · rg_factor still 309/309 · 2024 season now present ·
           no team silently dropped.
E2d  ★ RE-RUN `derive_conf_opr_htp.ts --apply --prod` — C28 step 3. REQUIRED, see §1.
     GATE: run_env_factor CHANGES from avg 101.879 (30/30 before and after — the count proves nothing).
```

---
# 🔬 ORDER AUDIT — TOPIC vs DATA DEPENDENCY → `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`
**The phase order in this document is organized by TOPIC (schema / config / producers / defense / precomputes /
re-bakes), NOT by what-feeds-what. A full read/write graph audit of every remaining step found TWO STRUCTURAL DEFECTS:**
1. 🔴 **PHASE E READS A TABLE PHASE F CREATES.** `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279`
   read `team_season_stats.faced_stuff_plus` / `.faced_htp`, whose ONLY producer is **F44**, the LAST step of Phase F.
   Prod's table is **0 rows**. The read **discards `error` and coerces to `[]`**, so the faced-competition adjustment
   for Independent programs **silently does not apply** — the only trace is a log line reading `0 … rows`.
   The docs gate **G46** on this table but never carried that gate back to E38. **→ F44 MUST MOVE BEFORE PHASE E.**
   ✅ No cycle: `refresh_team_season_stats` does NOT read `player_predictions` (grep = 0), so a clean total order exists.
2. 🔴 **A REQUIRED STEP IS IN NO RUNBOOK.** `refresh_team_season_stats.sql:143` divides by `sum(regular_season_ip)`,
   which is **0/5,375 on prod** ⇒ `nullif(...,0)` → **NULL** ⇒ every regular-season rate in `team_season_stats` lands
   NULL, silently. Producer = `scripts/lock-season-cli.ts` ("Lock Regular Season 2026"), which appears as a numbered
   step **nowhere**. **→ ADD AS `D33b`, before F44.**
**CORRECTED ORDER (derived from the graph, not the topic):**
`D29b → D30 → D31 → D32 → ★D33b lock-season → E2 → ★re-run derive_conf_opr_htp → ★F44 → E35 → E36 → E37 → E38 →
F39 → F40 → F41 → F42 → F42b → F43 → G46`
**Edges the topic order got RIGHT (do not churn):** F39-after-E · F40→F41→F42 · E35-before-precomputes · C27→C26→C28 ·
G46 last. Full evidence, per-step reads/writes, and the three Track B requirements are in the audit doc.

---
# 🔬 ORDER AUDIT PART 2 — PHASES A, B, C (THE WORK ALREADY DONE). Was any of it run out of order, or since invalidated?
Trevor: *"you audited everything we already did as well included in that correct?"* — **Initially NO. Now yes.**
Part 1 audited only the REMAINING steps. This part runs the same read/write graph over the COMPLETED work and asks the
question that actually matters: **is anything we already ran now STALE because of something else we ran after it, or
something we are about to run?** Verified against prod, not reasoned.

## ✅ RESULT: EVERY COMPLETED STEP IS STILL VALID. Nothing already run needs redoing. Two near-misses, both clean.
| edge | verified | verdict |
|---|---|---|
| chain 1→2 | `derive_stuff_plus_pop_baseline` reads `_reclass_pf` + `pitch_log_corrected` (reclassifier outputs) | ✅ correct order |
| chain 2→3 | `compute_pitch_log_stuff_plus` reads `pitcher_stuff_plus_ncaa` (chain 2) | ✅ |
| chain 3→4 | aggregation reads scored `pitch_log` | ✅ |
| chain 4→**C27** | `computeNcaaAverages:347` reads **`pitch_log_pitcher_totals`** and weights Stuff+ by `stuff_plus_data_pitches` (`:24-26` — the LIVE pitch_log lane, explicitly NOT the legacy PSP-I) | ✅ correct lane AND correct order |
| C24→C28-4 | Conference Stuff+ = `Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)` — needs C24's `trackman_pitches` AND the chain-5 `stuff_plus` | ✅ both were run first |
| C27→C26 | `computeAndStoreScores` reads `ncaa_averages`, silently defaults if absent | ✅ C27 ran first (this was CORRECTED earlier this push) |
| C29→C28 | both C28 producers filter on `division` | ✅ C29 ran first |
| C26→C28-2 | `compute_conf_pitcher_env_plus` reads `"Pitching Master"` + `ncaa_averages` | ✅ |
| C27→C28b | `conferenceScoutingAverages` reads `ncaa_averages`, errors loudly if missing | ✅ |

## ✅ NEAR-MISS 1 — **PHASE D DOES NOT INVALIDATE PHASE C.** (Checked because it easily could have.)
If `computeNcaaAverages` (C27) or `computeAndStoreScores` (C26) read any `desc_*` / WAR column, then Phase D writing
those columns would make C26/C27 stale and force a re-run of the whole back half of Phase C.
**Grepped both for `desc_owar|desc_pwar|d_war|bsr_war|total_desc_war|drs_behind|regular_season_*`: ZERO hits.**
→ **Phase D and Phase C touch DISJOINT Master columns. No re-run needed.** ✅

## ✅ NEAR-MISS 2 — **D31 DOES NOT CLOBBER C26's POWER RATINGS.** (The dangerous shape would be a full-row upsert.)
`populate_descriptive_war.mjs:156` is **`.update(cols).eq("source_player_id",…).eq("Season",…)`** — a **PARTIAL column
UPDATE**, not `.upsert()` of a whole row. It writes only its own `desc_*` columns and leaves C26's
`ba/obp/iso_power_rating`, `pRV+`, `era⁺…` untouched. ✅
⚠ **BUT NOTE ITS ERROR HANDLING:** `:157` is `if (error) { console.error(…) }` — errors are **printed, not counted,
and not fatal**, inside a 10,715-update loop that then **exits 0**. Another "validate by CONTENT, not exit code" case.
**Gate D31 on the non-null counts, never on the exit code.**

## ✅ NEAR-MISS 3 — **C27 DID NOT OVERWRITE PHASE B's TUNED CONFIG.** (C27 upserts `model_config`, so this was real.)
`computeNcaaAverages:428` upserts `model_config` `onConflict: model_type,season,config_key` — it would silently
overwrite any Phase-B key it shares. **Verified on prod AFTER C27 ran:** `nil_tier_sec = 4.0` ✅ ·
`r_obp_std_pr = 31.89504` ✅ · **220 keys** (unchanged) ✅ · **6** `_sd_good`/`_sd_bad` keys with **0** still reset to 0 ✅.
C27's keys (`p_ncaa_avg_*` / `p_sd_*`, e.g. `p_ncaa_avg_stuff_plus = 100.0141`) are **DISJOINT** from Phase B's tuned
weights. **Phase B survived C27 intact.** ✅

## 🛑 DEFECT FOUND IN THE ALREADY-DONE WORK — THE VERIFICATION GATE ITSELF USES KEY NAMES THAT DO NOT EXIST
The documented Phase-B gate reads `obp_std_pr=31.89504, whip_pr_sd=37.19844, owar_repl_600`. **None of those key names
exist on prod.** The gate query returns **ZERO ROWS** — and a zero-row result reads as *"the config is missing"*, which
would send the next person chasing a non-existent Phase-B failure.
**REAL KEY NAMES (verified on prod, values all CORRECT):**
`r_obp_std_pr` = **31.89504** · `t_obp_std_pr` = **31.89504** · `p_whip_pr_sd` = **37.19844** ·
`owar_replacement_runs_per_600` = **21.22** · `pwar_replacement_runs_per_9` = **1.92** · `nil_tier_sec` = **4.0**.
✅ **Corrected INLINE** at the gate in `PROD_PUSH_STEPS` and at RUNBOOK rows 1–2 (which additionally carried the
superseded VALUES 37.13 / 32.41).

## 🧠 THE PATTERN ACROSS BOTH AUDIT PARTS
Part 1 (remaining steps) found **2 structural defects**. Part 2 (completed steps) found **0 invalidations but 1 broken
gate** — the verification query itself was wrong, which is the most expensive kind of error because it makes correct
work *look* broken and broken work *look* fine.
→ **Audit the GATES with the same rigour as the steps.** A gate that cannot fail, or cannot pass, is not a gate.

---
# 🔴 PROD DATA GAP FOUND VIA team_drs — **CAMDEN KOZEAL (Arkansas) IS MISSING FROM PROD'S 2026 HITTER MASTER**
**CONFIRMED BY TREVOR 2026-08-30: Kozeal is a real player.** This is a genuine prod defect, not a reconciliation artifact.

## HOW IT SURFACED (the detector was not the defect)
Prod-derived `team_drs` disagreed with staging's stored value on exactly one team — **Arkansas 32.800 vs 41.060
(Δ −8.26)** — while 303/308 teams agreed within 0.5. Chasing it down:
1. **Per-player dRS is IDENTICAL across environments.** `player_season_defense` 2026: prod 13,454 / staging 13,454,
   both `drs-engine-0.11.0`; matched on `(source_player_id, position)` → **13,453 in both, 13,453 identical, ZERO
   different.** The engine output is env-independent (loaded from the same CSVs, per `PROD_PUSH_STEPS:316-317`), so
   **dRS drift is RULED OUT.**
2. **Arkansas roll-up:** prod **41** defense rows Σ **35.255** · staging **43** rows Σ **43.757**. Prod loses 2 rows.
3. **Both rows are ONE player — `source_player_id` 1925267789: SS 7.959 + 2B 0.543 = 8.502 runs.** That is the whole Δ.

## THE DEFECT
| | |
|---|---|
| STAGING `"Hitter Master"` 2026 | `Camden Kozeal` · Team **Arkansas** · **pa 289** · D1 |
| **PROD `"Hitter Master"` 2026** | **ABSENT** |
| PROD `"Pitching Master"` 2026 | absent |
| PROD `players` | **row EXISTS** — `Cam Kozeal` · 1B · **`team` = NULL** · D1 · NOT IN PORTAL |
| STAGING `players` | `Camden Kozeal` · 1B · team `Arkansas` |
Prod **knows the player** (same `source_player_id`) but stores him as "**Cam**" with a **NULL team**, and has **no 2026
Master stat row**. His dRS rows sit in prod's `player_season_defense` with nothing to join them to.
⚠ Note the name form differs (**Cam** vs **Camden**) and prod's `team` is NULL — consistent with
[[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). **If the Master import resolves on NAME
anywhere rather than `source_player_id`, that is the root cause and is far broader than one player**
([[feedback_id_over_name]]). NOT yet investigated — do not assume.

## SCOPE — SMALL AND BOUNDED (this is NOT a systemic Masters gap)
2026 **D1** Master id sets: **prod 10,406 · staging 10,408** · in staging not prod **4** · in prod not staging **2**.
Of the 4 staging-only ids only two carry defense: **Camden Kozeal 8.502** and **LJ Layhew (Rice, 1 PA) 0.002** —
**total prod loses 8.50 runs, essentially all Kozeal.**

## BLAST RADIUS ON PROD (everything below is currently wrong or missing for this player)
- **no `desc_owar` / `d_war` / `bsr_war` / `total_desc_war`** — D31 iterates the Masters, so he is simply not computed
- **no power ratings, no projection, no market value, no NIL** — every producer keys off a Master row
- **Arkansas `team_drs` understated by 8.26** ⇒ every Arkansas pitcher's `drs_behind` is wrong
  (`drs_behind = team_drs × IP/team_IP`) ⇒ wrong `desc_ra9` / `desc_pwar` for the whole staff
- **Arkansas team WAR roll-ups** (`team_war_snapshots`, later `team_season_stats`) understated
- ⚠ **Arkansas is one of the 14 ACTIVE customer teams.**

## ★ WHY NO GATE WOULD HAVE CAUGHT THIS
Prod has **5,340** D1 hitters and every count check passes on 5,340. A missing row is invisible to a count — you can
only see it by **diffing the id SET against a reference**, which nothing in the runbook does.
→ **ADD A MEMBERSHIP GATE, not just a count gate:** diff 2026 Master `source_player_id` sets prod-vs-staging (or vs the
source CSV) and require the difference to be explained by name, never merely small. Same lesson as the C28
`Stuff_plus` catch: **populated ≠ correct**, and now **count-correct ≠ complete**.

## ⬜ OPEN — NOT FIXED, NEEDS TREVOR'S CALL
1. How the missing Master row gets added (Masters are TruMedia CSV imports → [[feedback_csv_import_prod_direct]]
   `npm run import:prod`; a hand-INSERT is NOT the documented path).
2. Whether the Master import matches on name anywhere (the Cam/Camden + NULL-team signal) — root-cause question.
3. Whether Phase D proceeds now and Kozeal is patched after, or the gap is closed first.
⛔ **DO NOT "fix" this by copying the row from staging** — same copy-instead-of-derive error as the team_drs paste.

---
# 🅱️ TRACK B REQUIREMENT — MASTER ROWS MUST BE CREATED FROM THE PITCH LOG, INDEPENDENT OF RETURNER STATUS
**Status: NOT DONE. Deliberately SKIPPED during the 2026-08-30 prod push (Trevor) — must be handled by Track B in the
full upload.** Do not fix by hand; do not copy the row from staging.

## THE RULE (Trevor, 2026-08-30)
> *"He's not a returner in 2027 but should be in there based on the process."*
**A player's presence in the season's Master is determined by whether he PLAYED that season — i.e. by his pitch-log
record — NEVER by whether he returns the following season.** The Master is the **descriptive record of 2026**.
Returner/transfer status is a *projection-side* concept (season 2027) and must have **zero** influence on whether a
2026 Master row exists. Any stage that skips creating a Master row because a player is not a returner is WRONG.

## THE CONCRETE CASE THAT EXPOSED IT — Camden Kozeal (Arkansas)
Found only because prod-derived `team_drs` disagreed with staging on exactly one team. Full detail in the
"PROD DATA GAP" block; the short version:
| | |
|---|---|
| PROD `pitch_log` 2026 | **1,103 pitches** |
| PROD `pitch_log_hitter_totals` (`all`) | **PA 287 · AB 243 · 20 HR · 36 BB · 54 K · 193 BIP · 59 barrels** |
| PROD `"Hitter Master"` 2026 | ❌ **NO ROW** |
| PROD `players` | exists as `Cam Kozeal`, **`team` = NULL** |
| STAGING `"Hitter Master"` 2026 | ✅ `Camden Kozeal` · Arkansas · pa 289 |
A full everyday season with 20 HR, on an **active customer team**, with **no Master row on prod** — therefore no
`desc_owar` / `d_war` / `total_desc_war`, no power ratings, no projection, no market value, and 8.5 runs of his
defense orphaned out of Arkansas's `team_drs`.

## ★ SCOPE IS MEASURED AND TIGHT — he is the ONLY real one
| 2026 hitter orphans (pitch-log totals, no Master row) | PROD | STAGING |
|---|---|---|
| all | 763 | 759 |
| **PA ≥ 50** | **1 (Kozeal, 287 PA)** | **0** |
| PA ≥ 150 | 1 | 0 |
The other ~762 orphans top out at **18 PA** and staging has 759 of the same — that is normal Master-inclusion
background, **NOT** a defect. Pitchers: 135 prod orphans, same character.
→ 🛑 **CORRECTED 2026-08-30: this warning was WRONG.** `--create-new` is ALREADY scoped — `MIN_PA` default **25** (`:74`) plus a **D1 gate** (`:473`). Of the 763 candidates on prod exactly **ONE** clears PA≥25 (Kozeal, 287); the rest top out at 18 PA. The threshold question is answered by the committed code: **25 PA / 20 BF**.

## WHAT TRACK B MUST DO (stage 5, the Masters rollup)
`scripts/derive_masters_from_pitchlog.ts` already builds Master rows from `pitch_log_*_totals` and already has the
`--create-new` flag (default OFF, per the standing rule "never create Master rows implicitly"). Track B must:
1. **Create missing Master rows from the pitch log** as part of the normal upload — gated by the **Master's own
   inclusion threshold** (a PA/IP qualifier), **NOT** by returner status, roster status, or portal status.
2. **Establish what that threshold actually is** before enabling creation — it is currently UNDETERMINED. The data
   says any cutoff between ~20 and ~250 PA isolates Kozeal from the background, but a hand-picked number is not an
   answer: find the rule the Master import itself uses and mirror it. ⬜ **OPEN QUESTION.**
3. Preserve the existing safety: never create rows implicitly/silently; log every row created, with name + PA/IP.
4. **Run BEFORE anything that iterates the Masters** — descriptive WAR, `team_drs`, power ratings, `computeNcaaAverages`,
   `refresh_team_season_stats`. A row created after those have run is a row that is missing from all of them.

## ★ THE GATE THIS NEEDS (a COUNT GATE CANNOT SEE THIS)
Prod has 5,340 D1 hitters and **every count check passes on 5,340** — a missing row is invisible to a count.
**MEMBERSHIP GATE, per season, after the Masters rollup:**
```sql
-- must return 0 rows; anything here PLAYED but has no Master record
select plt.batter_id, plt.pa from pitch_log_hitter_totals plt
where plt.season = :season and plt.dimension_key = 'all' and plt.pa >= :qualifier
  and not exists (select 1 from "Hitter Master" hm where hm."Season" = :season and hm.source_player_id = plt.batter_id);
```
(and the `pitch_log_pitcher_totals` / `"Pitching Master"` equivalent by IP).
**Require it to be EMPTY, or every exception explained BY NAME — never merely "small".** This is the third distinct
shape of the same lesson: *populated ≠ fresh* (Conference Stuff+), *populated ≠ right lane* (`trackman_pitches`), and
now ***count-correct ≠ complete***.

---
# 🔬 INVESTIGATION — THE MASTER NEW-ROW PATH (`derive_masters_from_pitchlog.ts --create-new`). TRACK B DEPENDS ON THIS.
Chasing why prod is missing Camden Kozeal's 2026 Hitter Master row turned into an audit of the **new-row creation
path itself** — the mechanism Track B must use on every upload. Everything below is VERIFIED on prod, read-only.

## ✅ CORRECTION TO MY OWN EARLIER WARNING — `--create-new` IS ALREADY CORRECTLY SCOPED
I previously wrote that `--create-new` "would create ~763 rows, 762 of which should not exist." **THAT WAS WRONG.**
The producer already gates new rows on **two** filters (`:469`, `:473`):
- **`MIN_PA` — default 25**, overridable via `--min-pa <n>` (`:74`, `:39`). Pitchers: `MIN_BF` default 20.
- **D1 gate** — `if (!team || team.division !== "D1") skip`.
Measured on prod: of **763** hitter new-row candidates, exactly **ONE** clears PA ≥ 25 — **Kozeal (287 PA)**. The other
762 top out at **18 PA**. So the flag self-scopes correctly and the threshold question I logged as OPEN is **ANSWERED
BY THE COMMITTED CODE: 25 PA / 20 BF.**

## ✅ THE ROW CAN BE DERIVED ENTIRELY FROM PROD — NO COPY FROM STAGING NEEDED
Verified prod's own pitch log reproduces staging's Master values **exactly**:
`AVG (38+18+2+20)/243 = .321` · `OBP (78+36+4)/287 = .411` · `SLG 160/243 = .658` — staging Master: **.321 / .411 / .658**.
And the identity resolves from prod alone: `pitch_log.batting_team_id = '3375'` → `"Teams Table"` (Season-filtered) →
`University of Arkansas · SEC · D1 · id 5679ed85-…`; name from `players`; hand from the pitch log (`batter_hand = L`).
★ **What a new Master row actually needs is NARROW.** Staging's Kozeal row has 60 populated columns, but the 11
`*_score` fields, the 4 power ratings, and the whole `desc_*`/`woba`/`wraa` block (+ `_reg`) are **DOWNSTREAM OUTPUTS**
of C26 and Phase D — they compute themselves once the row exists. (Proof: prod's reference Arkansas hitter has only
**45** populated columns, precisely because Phase D has not run there.) Only identity + slash line + the batted-ball /
discipline block must be seeded, and all of it is pitch-log-derived anyway.
⛔ **So there is NO justification for copying the row from staging** ([[feedback_derive_over_copy]]).

## 🔴 UNRESOLVED CONTRADICTION — EVERY GATE PASSES, YET THE RUN REPORTED 0 NEW ROWS
Gate-by-gate trace for `source_player_id 1925267789` against PROD (each verified individually):
| gate | result |
|---|---|
| in `pitch_log_hitter_totals` (season 2026, `dimension_key='all'`) | ✅ YES, `pa = 287` |
| already has a 2026 `"Hitter Master"` row (→ would exclude) | ✅ NO — he IS a candidate |
| representative `pitch_log` row (`repRows`, `:444`) | ✅ `batting_team_id='3375'`, `C. Kozeal`, hand `L` |
| `teamBySource.get('3375')` (Teams Table, Season-filtered) | ✅ Arkansas, SEC, **D1**, Season 2026 |
| `MIN_PA` ≥ 25 | ✅ 287 |
**And a faithful replica of `buildNewRows`' candidate selection — same ordered pagination, same filters — returns:**
```
hmAll (Hitter Master 2026): 8244 rows → 8244 distinct   contains Kozeal? NO  ← candidate
hitterTotals:               6099 rows → 6099 distinct   contains Kozeal? YES pa=287
newHitterIds: 763           includes Kozeal? YES
  of those PA>=25: 1  → ["1925267789"]
```
→ **The producer SHOULD create exactly one row: his. The dry-run reported `0 hitters, 0 pitchers` and
`(skipped — non-D1 team / unresolved identity / below sample gate: 898)`.**
⚠ The captured output was **missing its header** (began mid-table, no env banner, no "Pitch-log totals: N hitters"
line), so the 0 may have come from a truncated or stale capture. ✅ **RESOLVED — the clean re-run confirmed `0` was REAL, and the root cause is now found: a wrong argument in the `repRows` call at `:465` (`"batting_team_id"` passed where `"batter_id"` belongs), whose timeout error is then discarded at `:451`. See the ROOT CAUSE block.**
**DO NOT resolve this by assumption. It is either (a) a capture artifact, or (b) a real silent failure in the new-row
path — and (b) would be a TRACK B BLOCKER, because a daily automated upload would silently never create anyone.**

## ⚠ SIDE-FINDING — STAGING'S KOZEAL ROW POINTS AT THE **2025** TeamID
Both envs carry two Arkansas `"Teams Table"` rows: `47acae04-…` (Season **2025**) and `5679ed85-…` (Season **2026**).
Staging's 2026 Kozeal Master row has `TeamID = 47acae04-…` — **the 2025 row.** The producer resolves Season-filtered
and would write `5679ed85-…`. Harmless for `team_drs` (both map to `source_id 3375`), but it means **staging's Master
`TeamID` values are not uniformly season-correct** — worth a separate check before anything joins on `TeamID` across
seasons. NOT investigated.

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **Use the committed producer with `--create-new` and its existing PA/BF + D1 gates.** Do not hand-build rows, do not
   copy across environments, do not invent a threshold — 25 PA / 20 BF is the committed answer.
2. **New-row creation MUST run before anything that iterates the Masters** (descriptive WAR, `team_drs`, power ratings,
   `computeNcaaAverages`, `refresh_team_season_stats`). A row created afterwards is missing from all of them.
3. **`--create-new` needs its own VALUE gate**, because "0 rows created" is indistinguishable from "nothing to create":
   after the stage, re-run the membership query and require it to be EMPTY. See the MEMBERSHIP GATE block.
4. **Never trust a background/truncated log.** Validate by re-querying the DB, or by a full captured run — this
   investigation was nearly concluded off a header-less capture. Same rule as "validate by CONTENT, not exit code."

---
# 🐛🔴 ROOT CAUSE FOUND — `derive_masters_from_pitchlog.ts` CAN **NEVER** CREATE A HITTER MASTER ROW (2026-08-30)
**This is a REAL, CONFIRMED BUG, not a capture artifact. It is a TRACK B BLOCKER.** Found by chasing why prod is
missing Camden Kozeal's 2026 Hitter Master row; the missing row is the *symptom*, this is the *cause*.

## THE DEFECT — AN ARGUMENT IN THE WRONG POSITION
```ts
async function repRows(ids, idCol, teamCol, abbrevCol, handCol) {        // :444
  … await sb.from("pitch_log").select(`${teamCol}, ${abbrevCol}, ${handCol}`)
        .eq("season", SEASON).eq(idCol, id).limit(1);                    // :451  ← filters on idCol
  if (data && data[0]) map.set(id, data[0]);                             // ← `error` is DISCARDED
}

repRows(newHitterIds,  "batting_team_id", "batting_team_id", "batter_abbrev_name", "batter_hand");  // :465 ❌
repRows(newPitcherIds, "pitcher_id",      "pitching_team_id", "pitcher_abbrev_name","pitcher_hand"); // :486 ✅
```
The **pitcher** call correctly passes `"pitcher_id"` as `idCol`. The **hitter** call passes **`"batting_team_id"`** —
the TEAM column — in the ID-column position. So it executes
`pitch_log WHERE season=2026 AND batting_team_id = '<a player id>'`.

## WHY IT FAILS SILENTLY (three failures stacked)
Verified on PROD:
```
AS CALLED  .eq('batting_team_id', playerId) → null   err: "canceling statement due to statement timeout"
CORRECT    .eq('batter_id',       playerId) → [{"batting_team_id":"3375","batter_abbrev_name":"C. Kozeal","batter_hand":"L"}]
```
1. A player id never matches a team id, so the predicate matches **nothing**…
2. …and scanning **2,576,146** `pitch_log` rows for it **EXCEEDS THE STATEMENT TIMEOUT** — it does not merely return
   empty, it **ERRORS**.
3. `:451` destructures **only `data`** and throws the error away ⇒ `rep` is `undefined` ⇒ `resolveTeam(undefined)` is
   `undefined` ⇒ `if (!team || team.division !== "D1") { skipped++; continue; }` ⇒ **skipped, silently.**
**Consequence: NO hitter Master row can EVER be created by this producer, on any environment, at any PA threshold.**

## THE EVIDENCE THAT PINNED IT (every other gate was cleared first)
Faithful read-only replicas against PROD, each ruling out a candidate cause:
| checked | result |
|---|---|
| `hmAll` (Hitter Master 2026, ordered pagination) | 8,244 rows / 8,244 distinct — Kozeal **NOT** present ⇒ he IS a candidate |
| `hitterTotals` (`pitch_log_hitter_totals`, `dimension_key='all'`) | 6,099 distinct — Kozeal present, `pa=287` |
| `newHitterIds` | **763**, includes Kozeal; **exactly 1** clears `MIN_PA=25` → `["1925267789"]` |
| `teamBySource` (Teams Table Season=2026) | 466 rows, 0 NULL `source_id`, `'3375'` → University of Arkansas **D1** ✅ |
| `repRows` replica using the **CORRECT** `batter_id` | **763 resolved · 0 errored · 0 no-row** |
| the ACTUAL run | **0 hitters created**, `skipped … 898` |
★ **`898 = 763 hitters + 135 pitchers` — i.e. EVERY candidate of both kinds.** A universal skip, not a selective one,
is what pointed at a shared gate rather than at the data.
(The 135 pitchers are separately explained by `MIN_BF=20`; the pitcher `repRows` call itself is correct.)

## ✅ THE FIX (one argument)
`:465` → `repRows(newHitterIds, "batter_id", "batting_team_id", "batter_abbrev_name", "batter_hand")`
**AND — independently — stop swallowing the error at `:451`:** `const { data, error } = …; if (error) { … }`. Count and
report failures; a timeout must never masquerade as "this player has no pitch-log row." Without this second change the
same class of failure stays invisible next time.

## 🅱️ WHAT THIS MEANS FOR TRACK B — READ THIS TWICE
Track B is **ONE EDGE FUNCTION RUNNING ONCE PER DAY, UNATTENDED.** This bug is precisely the failure mode it cannot
survive:
- the stage **runs**, **exits 0**, and prints a plausible number (`0 new rows`)
- "0 created" is **indistinguishable** from "nothing to create" — and 362 days a year, "nothing to create" is the
  truth, so it looks right
- the only visible symptom is a **missing row**, which **no count gate can detect** (prod has 5,340 D1 hitters and
  every count check passes on 5,340)
- it took a **team-level dRS discrepancy on one team** to surface a **single missing player**
**Therefore Track B MUST:** (1) treat any swallowed error as a **hard stop**, never a coerced empty; (2) gate the
new-row stage on the **MEMBERSHIP query**, not on a count or an exit code; (3) **log every row it creates by name +
PA/IP**, and log explicitly when it creates none *and why*.

## 🧠 THE META-LESSON — THE FOURTH SHAPE
1. *populated ≠ fresh* (Conference `Stuff_plus` 30/30 but pre-v2)
2. *populated ≠ right lane* (`trackman_pitches` full, from the legacy table)
3. *count-correct ≠ complete* (5,340 hitters, one of them missing)
4. **NEW: *ran ≠ did anything*** — a stage can execute, exit 0, report a believable figure, and be structurally
   incapable of ever doing its job.
**And the process lesson:** I nearly closed this off a truncated background log that was missing its header. The clean
full capture is what confirmed `0` was real and sent me to the code. **Never conclude from a partial log.**

---
# 🅱️ TRACK B — MASTER `TeamID` IS NOT SEASON-CONSISTENT, AND A SPLIT IS SILENT UNTIL IT ISN'T (2026-08-30)
## THE UNDERLYING CONDITION
`"Teams Table"` carries **one row per team PER SEASON** — prod has **308 rows for Season 2025** and **466 for 2026**,
each with its own `id`. So a single program has MULTIPLE `TeamID` uuids. Arkansas (`source_id 3375`):
`47acae04-1225-4506-9c12-8d6e55cbe9c5` = **Season 2025** · `5679ed85-eeea-4e47-be59-53ffc5087b38` = **Season 2026**.
**The 2026 Masters do NOT consistently use the 2026 id.** Measured on PROD, Season 2026, Arkansas:
| table | `47acae04…` (2025 id) | `5679ed85…` (2026 id) |
|---|---|---|
| `"Hitter Master"` | **16** | 0 |
| `"Pitching Master"` | **18** | **1** ⚠ |
Staging's 2026 Kozeal row likewise carried the **2025** id. **So the 2025 id is the DE-FACTO convention in the 2026
Masters, and the lone pitcher on the 2026 id is a PRE-EXISTING SPLIT that predates this session.** ⬜ NOT FIXED —
logged for whenever the Master `TeamID` question is addressed properly.

## 🛑 WHY THIS MATTERS — ANY TEAM-LEVEL ROLLUP KEYED ON `TeamID` SILENTLY SPLITS THE TEAM
`derive_team_drs.mjs` groups `Σ drs_floor` by the Masters' `TeamID`. If one player carries a different (but equally
"valid") `TeamID` for the same program, he becomes **his own team**. Demonstrated live: after inserting Kozeal with the
**2026** id (I "corrected" staging's 2025 id, assuming it was a bug — **IT WAS NOT**), the producer emitted:
```
div D1: 309 teams          ← was 308
Arkansas  team_drs 32.770  raw_floor 35.255  team_IP 475.0
Arkansas  team_drs  8.429  raw_floor  8.502  team_IP  14.0   ← Kozeal, alone, as a "team"
```
Reverting his `TeamID` to `47acae04…` restored **308 teams**, `raw_floor 43.757` (**exactly staging's**), `team_drs 41.272`.
★ The split announced itself ONLY because the division team-count moved 308→309 and the centering assertion still held.
**A per-team value check would have passed** — both buckets are internally consistent. **What caught it was a
CARDINALITY check.**

## 🅱️ REQUIREMENTS FOR TRACK B
1. **Resolve `TeamID` ONE way, from ONE place, for the whole run** — do not mix a per-season lookup with whatever the
   Masters happen to hold. Prefer joining on **`source_team_id` / `source_id`** (season-stable) over the per-season
   uuid wherever a rollup groups by team. [[feedback_id_over_name]] extends here: *stable* id over *any* id.
2. **When creating a Master row, adopt the `TeamID` its TEAMMATES already use** — never resolve it independently from
   `"Teams Table"` by season. That is exactly the mistake made here, and it silently split a customer team.
3. **CARDINALITY GATE on every team-level rollup:** assert the produced team count EQUALS the expected division count
   (D1 = 308) and FAIL otherwise. A per-team value gate cannot see a split; a count of teams can.
4. The zero-sum centering assertion (`Σ centered = 0`) **does NOT protect against this** — it held at 309 teams.

## ✅ D29b DONE ON PROD (2026-08-30) — team_drs DERIVED, not pasted
`scripts/drs/derive_team_drs.mjs --prod` (guard + ordered pagination added this session; reproduces staging's committed
values **308/308 exact**, worst |Δ| 0.0000) → `scripts/sql/team_drs_store_PROD_2026_08_30.sql` → applied.
`BEFORE with_drs 308 · sum -0.01 · Arkansas 41.060 (staging paste)`
`AFTER  with_drs 308 · sum  0.00 · Arkansas 41.272 (PROD-DERIVED)`  — 308 rows updated.
Residual vs the old staging values: **mean |Δ| 0.100**, max ~0.54 — prod's D1 population differs slightly (5,341 vs
5,343 hitters), shifting the centering rate. Expected, not a defect.
**Also on prod:** Camden Kozeal's 2026 Hitter Master row INSERTED (5,340 → **5,341** D1 hitters) — 31 seed columns,
**all 29 derived columns deliberately omitted** so C26 and Phase D compute them on prod.

---
# ✅ D31 DESCRIPTIVE WAR — APPLIED TO PROD 2026-08-30. Verified IN THE DATABASE, not from the log.
`node scripts/drs/populate_descriptive_war.mjs --prod --commit` (run under `caffeinate -dimsu`, full output captured).
`Hitter Master: 5340/5340 written, 0 FAILED` · `Pitching Master: 5374/5374 written, 0 FAILED` · `done. 0 write errors.`
★ **That "0 FAILED" line only exists because of the fix made earlier the same day** — write errors were previously
`console.error`'d but **NOT counted and NOT fatal** inside a ~10,715-update loop that then exited 0, so a partial write
was indistinguishable from a clean one. Now counted, summarised per table, and `exit 1` on any failure.

## PHASE GATE — PROD vs STAGING REFERENCE (2026, D1)
| metric | PROD | staging ref | ✓ |
|---|---|---|---|
| `desc_owar` mean | **0.3458** | 0.3456 | ✅ |
| `d_war` mean | **0.0103** | 0.0103 | ✅ |
| `bsr_war` mean | **0.0000** | 0.0000 | ✅ |
| `total_desc_war` mean | **0.3562** | 0.3559 | ✅ |
| `desc_pwar` mean | **0.5108** | — | ✅ |
| sum identity `max abs(total_desc_war − (desc_owar+d_war+bsr_war))` | **0.001000** | ≤ 0.002 | ✅ |
| coverage | hitters **5,340 / 5,341** · pitchers **5,374 / 5,375** | — | ✅ |
| `drs_behind` | **5,374** populated · range **−5.26 … 6.84** · **7** exact zeros | — | ✅ |
`bsr_war` (= `wsb_runs / RPW 13.1`, from `player_season_baserunning`) range **−0.386 … 0.502**, centered at 0.
The single missing hitter and pitcher are the pre-existing `sheet-miss 1` — players absent from the source CSV,
unchanged from before this run. NOT a defect.

## ★★ THE STRONGEST VALIDATION OF THE DAY — INDEPENDENT REPLICATION ON CAMDEN KOZEAL
```
PROD    Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
STAGING Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
```
**IDENTICAL to three decimals.** A player who had **no Master row and no numbers at all on prod** hours earlier now
matches the reference exactly — computed from **prod's own** pitch log, **prod's own** Master row (31 seed columns,
zero derived columns copied), **prod's own** `player_season_defense`, and a `team_drs` **derived on prod**. Nothing was
copied from staging except the seed stat line, which was itself cross-checked against prod's pitch log (.321/.411/.658).
★ This closes the loop opened by the Arkansas `team_drs` discrepancy: detector → missing player → root-cause bug →
row created → `team_drs` re-derived → descriptive WAR matches. **Every link verified, none assumed.**

## ORDER NOTE FOR THE NEXT STEP (D32) — THE SILENT ONE
`populate_descriptive_war_reg.mjs:79` reads `"Pitching Master".drs_behind` and coerces **`NULL → 0`**, so running it
before D31 commits yields wrong `desc_ra9_reg` / `desc_pwar_reg` with **NO error**. Gate satisfied: `drs_behind` is
**5,374/5,375 non-null** on prod. **Verify this count, never "D31 exited cleanly".**

---
# ✅✅ PHASE D COMPLETE ON PROD — 2026-08-30. D34 verification passed on every gate.
| step | result |
|---|---|
| **D29b** `team_drs` | **DERIVED on prod** (not pasted) via `derive_team_drs.mjs --prod` → 308 D1 teams, Σ centered −0.0000, stored: `with_drs 308 · sum 0.00`. Arkansas 41.060 → **41.272**. |
| **D30** dRS/wSB load | **NO-OP confirmed** by dry-run — `13454 would upsert / 11 unresolved`, `10432 / 30 unresolved`; data already present at `drs-engine-0.11.0` / `0.6.0`. Apply intentionally SKIPPED. |
| **D31** descriptive WAR | **COMMITTED** — `Hitter Master 5340/5340 written, 0 FAILED` · `Pitching Master 5374/5374 written, 0 FAILED` · `0 write errors`. |
| **D32** `_reg` split | **COMMITTED** — `Hitter Master 5322/5322` · `Pitching Master 5372/5372`. |
| **D33** | folded into D29b (it IS the `team_drs` producer). |
| **D34** | **PASSED — all 9 checks below.** |
| *(unplanned)* | **Camden Kozeal's 2026 Hitter Master row CREATED** → 5,340 → **5,341** D1 hitters. |

## D34 RESULT (prod, Season 2026, division='D1') — the numbers to compare against next time
```
✅ hitters desc_owar/d_war/bsr_war/total_desc_war   5340/5340/5340/5340 of 5341
✅ hitters _reg set                                 5322/5322/5322/5322
✅ pitchers desc_pwar/desc_ra9/drs_behind           5374/5374/5374 of 5375
✅ pitchers _reg                                    5372/5372
✅ avg d_war      0.0103   (≈0.010)
✅ avg bsr_war    0.0000   (≈0.000)
✅ avg desc_owar  0.3458   (≈0.346)
✅ sum identity   0.001000 (≤0.002)   max|total_desc_war − (desc_owar+d_war+bsr_war)|
✅ drs_behind range  −5.26 … 6.84
ℹ  avg total_desc_war 0.3562 · _reg 0.3354 · avg desc_pwar 0.5108 · _reg 0.5385
```
The one uncovered hitter and pitcher are the pre-existing `sheet-miss 1`; the 19 hitter / 3 pitcher `_reg` shortfalls
are players absent from `hitter_accrued.csv` / the line file — **matching staging exactly (5,322 and 5,372)**. Expected.

## ⚠ KNOWN GAP CARRIED FORWARD — `populate_descriptive_war_reg.mjs` STILL SWALLOWS WRITE ERRORS
The error-counting fix (count failures, summarise per table, `exit 1`) was applied to **`populate_descriptive_war.mjs`
ONLY**. `_reg` still logs errors without counting them and prints a bare `done.` — so a partial `_reg` write would
still look clean. It happened to succeed here (`5322/5322`, `5372/5372` progress counters reached full), but
**apply the same fix to `_reg` before it is ever re-run.** ⬜ OPEN.

## ▶️ NEXT PER THE CORRECTED ORDER (NOT the topic order)
`E2` park factors seasonal → **★ re-run `derive_conf_opr_htp --apply --prod`** (E2 rewrites `rg_factor`, invalidating
C28's `run_env_factor`/`hitter_talent_plus` at 30/30 — a count check will PASS either way) → `D33b` lock-regular-season
(`regular_season_ip` is 0/5,375 and `refresh_team_season_stats` divides by it) → **`F44` MOVED UP** (Phase E reads
`team_season_stats.faced_*`) → `E35` TWP → `E36/37/38` precomputes → `F39`… See
`docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`.

---
# 🚨 THE EXACT MATH + THE THINGS THAT MUST BE CAUGHT (2026-08-30). Every number here is VERIFIED ON PROD.
Consolidated so a reader never has to reconstruct a formula or a constant from prose. **If a number below does not
reproduce, STOP — do not proceed to the next stage.**

## 1. THE CONSTANTS (from `populate_descriptive_war.mjs`'s own banner, prod run 2026-08-30)
```
RPW 13.1   E2T 1.1373   replRA9 8.83   wOBA lg 0.3782   wOBA scale 0.947   offense replacement 1.62/600
```
`RPW = 13.1` is the divisor for **every** WAR quantity. ⚠ Older docs say ÷10 (Push-1 v1) — **SUPERSEDED**.

## 2. DESCRIPTIVE WAR — THE ACTUAL FORMULAS
```
HITTER   wraa            = ((woba − lgwOBA 0.3782) / wOBAscale 0.947) × PA
         desc_owar       = wraa/13.1 + (PA/600) × 1.62
         d_war           = Σ drs_floor (positions ≠ P) / 13.1
         bsr_war         = wsb_runs / 13.1
         total_desc_war  = desc_owar + d_war + bsr_war          ← IDENTITY, must hold to ≤0.002
PITCHER  drs_behind      = team_drs × (pitcher_IP / team_IP)     ← Σ over a team's pitchers = 0 EXACTLY
         desc_ra9        = 0.5 × (RA9 + drs_behind_per9) + 0.5 × (FIP × 1.137)
         desc_pwar       = (replRA9 8.83 − desc_ra9) × (IP/9) / 13.1
TEAM     team_drs        = Σ drs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP
                           ← innings-weighted centering PER DIVISION; Σ centered = 0 EXACTLY
```

## 3. THE VERIFIED PROD NUMBERS (Season 2026, division='D1') — compare against these
```
hitters 5,341 rows · desc_owar/d_war/bsr_war/total_desc_war = 5,340 each · _reg set = 5,322 each
pitchers 5,375 rows · desc_pwar/desc_ra9/drs_behind = 5,374 each · _reg = 5,372
avg desc_owar 0.3458   avg d_war 0.0103   avg bsr_war 0.0000   avg total_desc_war 0.3562  (_reg 0.3354)
avg desc_pwar 0.5108  (_reg 0.5385)       drs_behind −5.26 … 6.84       sum identity worst 0.001000
team_drs: 308 D1 teams · sum 0.00 · Arkansas 41.272 (raw_floor 43.757, team_IP 475.0)
Conference Stuff+ D1 99.15 · NJCAA_D1 96.00 · D2 93.00     p_ncaa_avg_stuff_plus 100.0141 · p_sd_stuff_plus 5.04577
Stuff+ per-pitcher gate: mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7  (IDENTICAL prod ↔ staging)
```

## 4. 🛑 THE SIX THINGS THAT MUST BE CAUGHT — each PASSED a naive check while being WRONG
| # | what | the naive check that PASSES | what actually catches it |
|---|---|---|---|
| 1 | **Conference `Stuff_plus` stale (pre-v2)** — 101.17, should be 99.15 | `count(*) = 30/30` ✅ | compare the VALUE before/after; it is written by a **4th producer** (`conferenceStuffPlusV2`) the runbook omitted |
| 2 | **`trackman_pitches` from the LEGACY lane** — undercounts ~12.1 pitches/pitcher, only **638/5,367 (11.9%)** matched | column fully populated ✅ | check the LANE, not the fill: D1 must come from `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'` |
| 3 | **`run_env_factor` goes stale under E2** — E2 rewrites `rg_factor`, which `derive_conf_opr_htp:10` reads | `30/30` before AND after ✅ | value must CHANGE from **101.879**; re-run `derive_conf_opr_htp` AFTER E2 |
| 4 | **Missing Master row (Kozeal, 287 PA, 20 HR)** | `5,340 = 5,340` ✅ | **MEMBERSHIP diff**, not a count — pitch-log PA ≥ qualifier with no Master row must be EMPTY |
| 5 | **`--create-new` structurally broken** — `:465` passes `"batting_team_id"` as `idCol`; query times out over 2,576,146 rows; `:451` discards `error` | exit 0, prints `0 new rows` ✅ | "0 created" ≠ "nothing to create" — gate on the MEMBERSHIP query, and NEVER swallow `error` |
| 6 | **Team split by `TeamID`** — one player on the 2026 uuid vs 16 on the 2025 uuid ⇒ Kozeal became his own 14-IP "team" | per-team values internally consistent ✅ · Σ centered = 0 **held at 309 teams** ✅ | **CARDINALITY gate**: assert D1 team count **= 308**, fail otherwise |

## 5. 🛑 SILENT-FALLBACK INVENTORY — a missing input yields a plausible WRONG number, with NO error
| producer | the coercion | consequence |
|---|---|---|
| `computeAndStoreScores.ts:206-211,:249` | missing `ncaa_averages` field → **hardcoded default** (`:212-215`) | wrong power ratings; **run C27 BEFORE C26** |
| `populate_descriptive_war_reg.mjs:79` | `num(NULL) → 0` on `drs_behind` | wrong `desc_ra9_reg`/`desc_pwar_reg`; **D31 must commit first** (gate: `drs_behind` 5,374/5,375) |
| `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` | `const { data } =` discards `error`; `(rows \|\| [])` | empty faced-competition Map ⇒ Independents lose the adjustment; **F44 must precede Phase E** |
| `refresh_team_season_stats.sql:143` | `nullif(sum(regular_season_ip),0)` → NULL | every regular-season rate NULL; **needs lock-season (`regular_season_ip` is 0/5,375 on prod)** |
| `compute_pitch_log_stuff_plus.ts` | `classification_version` filter mismatch | scores **0 rows, exits 0**; pass the stamp just written, never a literal |
| `derive_masters_from_pitchlog.ts:451` | discards `error` on a timing-out query | **no hitter row can ever be created** |

## 6. ✅ THE GATES THAT ACTUALLY WORK (use these, not counts)
1. **VALUE gate** — compare the number before/after, and to a reference env for the SAME season (2026 = descriptive, 2027 = projections).
2. **MEMBERSHIP gate** — diff the ID SET, not the count. Caught Kozeal.
3. **CARDINALITY gate** — assert the expected number of GROUPS (D1 = 308 teams). Caught the `TeamID` split.
4. **IDENTITY gate** — `total_desc_war = desc_owar + d_war + bsr_war` ≤ 0.002; `Σ team_drs = 0`; `Σ drs_behind = 0`.
5. **LOG-CONTENT gate** — read the log body, never the exit code. `0 FAILED` must be printed, not inferred.
6. **SIGN gate** — arm-side pitches positive armHB for BOTH hands (18/18 buckets), else ABORT before writing.

---
# ✅ E2 PARK FACTORS + MANDATORY C28-STEP-3 RE-RUN — APPLIED TO PROD 2026-08-30
## E2a — code fixes first (the docs already called for the guard; the banner was found during the dry run)
- double-keyed `--prod` guard + env-driven URL/key (was a **literal staging URL** + literal `.env.local` read).
- 🛑 **LYING BANNER FIXED** — `:215` printed `MODE: … target=STAGING` **while running against PROD**. Identical defect
  to `_run_store_no_propagate.ts` (C26). Now prints the RESOLVED env. **Third instance of this class.**

## E2b — DRY RUN + the TEAM-BY-TEAM GATE (a row count would have hidden this)
`_parkfactors_backup` verified **615 rows = 306 (2025) + 309 (2026)** before touching anything.
CSV 2026 = **308** teams vs PROD 2026 = **309** rows ⇒ delete+reinsert would drop one.
**Diffed BY NAME: the single dropped team is `Fort Wayne`.** ✅ **CORRECT — Trevor: they had no 2026 team.**
⚠ My first diff was WRONG and briefly reported "309 would be dropped" — my probe matched the CSV's **`teamId`**
column instead of **`team`** (`/team/i` hits `teamId` first). Corrected immediately. **The real name column is `team`
(index 3): `Rank,teamId,teamName,team,teamFullName,…`.** Do not re-derive this by regex; use the literal column name.

## E2c — APPLIED. `✓ Wrote 922 rows across 2024/2025/2026 (seasonal + main).`
| season | rows before → after | `rg_factor` | **`rg_factor_seasonal`** |
|---|---|---|---|
| 2024 | *(absent)* → **307** | 307 | **307** |
| 2025 | 306 → **307** | 307 | **307** |
| 2026 | 309 → **308** | 308 | **308** |
**`rg_factor_seasonal` 0/309 → fully populated — the objective of E2.** Georgia 2026 `rg_factor` = **109.35**,
exactly the dry-run's predicted rolling value; `rg_factor_seasonal` = 107.76 (single-season). Fort Wayne now present in
2024/2025 only. ⚠ `source_team_id` is 306/307 for 2024 and 2025 (2 unmapped historical teams) — 308/308 for 2026.

## ★ E2d — THE MANDATORY RE-RUN, AND THE NUMBER THAT PROVES IT
E2 rewrites the **MAIN** factor columns (current season → 3-yr rolling), and `derive_conf_opr_htp.ts:10` reads
`"Park Factors".rg_factor`. Measured rewrite magnitude from the dry run:
```
RG  mean|Δ| 2.16  max|Δ| 7.24 (n=308)   ISO mean|Δ| 2.11  max 7.07   AVG 0.65   OBP 0.38
worst: Monmouth/rg 100.3→93.06 · Mississippi Valley State/rg 134.44→127.52 · Northern Colorado/rg 121.5→115.08
```
`npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod` → **APPLIED 30 rows.**
| | BEFORE | AFTER |
|---|---|---|
| `run_env_factor` **count** | **30/30** | **30/30** ← ⚠ **IDENTICAL — a count gate PASSES either way** |
| `run_env_factor` **avg** | **101.879** | **99.719** (**−2.16**) |
| `hitter_talent_plus` avg | 100.13 | **99.23** (−0.90) |
★★ **The `run_env_factor` shift of −2.16 EQUALS the park `RG mean|Δ|` of 2.16.** The competition-translation lever
moved by exactly the amount park factors moved. Had E2 been run in its documented Phase-E slot *after* C28, this value
would have been silently stale at a passing 30/30 — biasing every projection of a player INTO a conference.
Division split intact: **D1 30 · NJCAA_D1 10 · D2 2.** Sample HTP moves: Big 12 117.2→**119.1** · SBC 103.8→**107.7** ·
Independent 109.1→**122** · MWC 95.7→**96** · The Summit 93.8→**93.4**.

## 🧠 RULE CONFIRMED BY MEASUREMENT
**`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.** Any stage that rewrites
`"Park Factors".rg_factor` invalidates `run_env_factor` / `hitter_talent_plus` / `offensive_power_rating` **without
changing their fill count**. Gate on the VALUE CHANGING, never on the count.

---
# 🔬 E2 PROD↔STAGING COMPARISON — HOW IT WAS VERIFIED, AND WHAT A DIFFERENCE MEANS (2026-08-30)
Run AFTER E2 + the `derive_conf_opr_htp` re-run. **Method matters as much as the result** — this is the template for
comparing the two environments now that they have diverged.

## METHOD (do it this way; a row count proves nothing)
1. **Structural:** row counts + non-null counts per season, both envs.
2. **VALUE-level:** pull all 2026 rows from each, **join on `team_name`**, compare each numeric field, report
   `matched / IDENTICAL / worst |Δ|` — never just "counts agree".
3. **Downstream:** compare the consumers (`Conference Stats`) separately, and **attribute every difference** to a
   named cause before calling it a defect.

## ✅ RESULT 1 — PARK FACTORS ARE *IDENTICAL*. This is INDEPENDENT REPLICATION, not a copy.
| | PROD | STAGING |
|---|---|---|
| rows 2024 / 2025 / 2026 | **307 / 307 / 308** | **307 / 307 / 308** |
| `rg_factor` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| `rg_factor_seasonal` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| **2026 `rg_factor` joined on `team_name`** | **308 matched · 308 IDENTICAL · worst \|Δ\| 0.0000** | |
| **2026 `rg_factor_seasonal`** | **308 IDENTICAL** | |
Same source CSVs, same formula, executed separately against two different databases → **byte-identical output**.
Prod's park factors are now in exactly the state staging is in. ★ This is the same class of evidence as the Stuff+
per-pitcher gate (mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 identical across two different pitch populations) and
the Kozeal descriptive-WAR match (2.404 / 0.649 / −0.051 / 3.002 to three decimals).

## ✅ RESULT 2 — `run_env_factor` IDENTICAL; the other two differ FOR A KNOWN REASON
| Conference Stats 2026 D1 | PROD | STAGING | verdict |
|---|---|---|---|
| `run_env_factor` | **99.719** | **99.719** | ✅ **identical** — the purely park-derived value. Identical parks ⇒ identical result. **The E2 → `derive_conf_opr_htp` chain is verified end-to-end.** |
| `Stuff_plus` | 99.15 | 99.16 | Δ −0.01 — immaterial |
| `hitter_talent_plus` | 99.23 | 99.01 | Δ +0.22 — **EXPECTED, see below** |
**Why HTP differs:** `HTP = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env)`. `run_env` is now identical and Stuff+ is
within 0.01, so the difference comes from **`offensive_power_rating`**, which is built off the **Masters** — and
**STAGING NEVER RECEIVED C24 / C26 / C27 / C28 / C28b / C29.** Its Master-derived inputs are OLDER.
🛑 **THEREFORE: PROD IS THE MORE CURRENT SIDE FOR THESE COLUMNS. A prod↔staging mismatch here is NOT a prod defect.**
Prod is also ahead on `pitcher_ev90`, `pitcher_exit_velo`, `pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`
(**30/30 prod vs 0/30 staging**) and `pitcher_ev_score`/`pitcher_iz_score` (**30/30 vs 0/30**).

## 🧭 THE RULE THIS ESTABLISHES — HOW TO READ ANY PROD↔STAGING DIFFERENCE FROM NOW ON
Before calling a difference a defect, answer **in this order**:
1. **Is the input identical?** (park CSVs, engine CSVs, pitch log) — if yes, an output difference is a real signal.
2. **Which env is BEHIND on the producing step?** Staging is missing C24/C26/C27/C28/C28b/C29. Prod is missing nothing
   in Phase C. **Whoever is behind explains the gap; do not "fix" the current side toward the stale one.**
3. **Is the differing column derived from the Masters?** If so, staging's drift explains it.
4. Only if 1–3 do not explain it is it a defect.
⛔ **NEVER reconcile prod TO staging by copying values.** That is what produced the `team_drs` paste that had to be
undone, and it would have carried staging's Arkansas 41.060 (a value prod could not reproduce) into prod permanently.

---
# 🅱️🔴🔴 TRACK B BLOCKER — **WAR MUST READ THE DB MASTERS, NOT TruMedia CSVs.** ARCHITECTURE DIRECTIVE (Trevor, 2026-08-30)
**THIS IS THE MOST IMPORTANT ITEM IN THIS DOCUMENT. Track B CANNOT WORK UNTIL IT IS FIXED.**

## THE DIRECTIVE, IN TREVOR'S TERMS
> *"derive_masters_from_pitchlog.ts needs to be the one that writes all the stats and even if a little off then it
> needs to be checked and overridden if off by the master sheets. The reason why is because on track b it is going to
> be absorbing pitch logs **every day through the spring**, but only ingesting master sheets **once a month or so** —
> and the only differences should be a check on some of the information as a 2nd source… things like **stolen base and
> ERA** that aren't always perfect from deriving the pitch log. That is why it has to run in the order I am mentioning
> and I am adamant about making sure it does in fact do that."*

## THE MANDATORY ORDER
```
pitch log (DAILY)  →  derive_masters_from_pitchlog.ts writes ALL stats to the Masters
                   →  WAR / power ratings / projections READ THE MASTERS (from the DATABASE)
                   →  TruMedia Master CSV (MONTHLY) = a CHECK / OVERRIDE layer only, applied ON TOP
```
The Master **sheet** is a *second source for verification*, not the primary. Override scope is narrow and specific:
**stolen bases and ERA**, plus anything else demonstrably not derivable cleanly from the pitch log.

## 🔴 THE BLOCKER AS IT STANDS TODAY — WAR IS WIRED THE WRONG WAY ROUND
`scripts/drs/populate_descriptive_war.mjs` reads its hitting and pitching lines **from CSV FILES ON DISK**:
```js
:75  const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
:76  const pitSheet = sheet("docs/drs-reference/Full Season Pitching Master Stats.csv");
:102 const PA = g("PA");         // ← from the CSV, NOT from "Hitter Master".pa
```
`"Hitter Master"` is queried at `:77` **only** to build the D1 id list (`source_player_id, division, pa`) — the `pa`
column is never used in the math. `populate_descriptive_war_reg.mjs` is the same shape, reading
`scripts/drs/output/hitter_accrued.csv` and `pitcher_line.csv`.
**⇒ In Track B there are no daily TruMedia season CSVs. A daily run would have NOTHING to read.** The WAR stage as
written is structurally incapable of running inside Track B.
★ It also means today's prod WAR was computed from **TruMedia season CSVs**, not from the pitch log — the exact
inversion of the pitch-log-primary architecture. It is CORRECT (it matched staging to four decimals) but it is
**SOURCED WRONG**, and that must not be carried into Track B.

## ✅ WHY THIS IS FIXABLE — EVERY INPUT ALREADY EXISTS, PITCH-LOG-DERIVED
Two pipelines already produce everything, and BOTH are pitch-log-sourced:
| source | window(s) | supplies |
|---|---|---|
| `pitch_log_{hitter,pitcher}_totals` (**DB**) | full | rates + batted-ball/discipline: `AVG OBP SLG ISO contact barrel chase bb line_drive gb pop_up la_10_30 k_pct avg_exit_velo ev90 pull pull_air`, pitcher `K9 BB9 HR9 WHIP FIP stuff_plus hard_hit_pct barrel_pct …`, and **`ip`** |
| `scripts/drs/output/hitter_accrued.csv` (27 cols) | **FULL + REG** | `PA AB H 2B 3B HR BB HBP SF SH AVG OBP SLG ISO` and `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH` |
| `scripts/drs/output/pitcher_line.csv` (37 cols) | **FULL + REG** | `full_IP full_BF full_K full_BB full_HBP full_H full_HR full_ER **full_ERA** full_R full_RA9 full_FIP full_WHIP full_K9 full_BB9 full_HR9 full_K_pct full_BB_pct` + the complete matching `reg_*` set incl. **`reg_ERA`** |
⚠ **Barrel%/EV are NOT in the engine CSVs** — they come from `pitch_log_hitter_totals`. Two pipelines, one lane.
★ **`full_ERA` and `full_IP` ALREADY EXIST** — yet `PITCHER_UNMAPPED = ["ERA","IP","G","GS","Role"]` still declares
them *"left to TruMedia Master (never written)"*. **That comment is now WRONG for ERA and IP.** Only `G`/`GS` (and
`Role`, which is not a stat) genuinely lack a pitch-log source today.

## 🔴 WHAT `derive_masters_from_pitchlog.ts` DOES **NOT** WRITE TODAY (the whole gap)
It ran on prod (`4,772 pitchers + 4,373 hitters · 0 new rows`) and today re-dry-runs at **0 changes** — so everything
in its write set already matches. **The gap is what is NOT in that set:**
| Master column | prod today | available from | status |
|---|---|---|---|
| `pa` / `ab` | **regular-season line** (avg pa 121.8 vs staging 128.0) | `hitter_accrued.csv` `PA`/`AB` | ❌ patched only on NEW rows |
| `regular_season_pa` | **0 / 5,341** | `hitter_accrued.csv` `reg_PA` | ❌ never written |
| `IP` | regular-season line | `pitcher_line.csv` `full_IP` · `pitch_log_pitcher_totals.ip` | ❌ in `PITCHER_UNMAPPED` |
| `regular_season_ip` | **0 / 5,375** | `pitcher_line.csv` `reg_IP` | ❌ never written |
| `ERA` | stale CSV import | `pitcher_line.csv` `full_ERA` | ❌ in `PITCHER_UNMAPPED` |
| `G` / `GS` | stale CSV import | *(no pitch-log source found)* | ⬜ Master-override only |
| SB / caught stealing | Master sheet | *(partially)* | ⬜ **Master-override by design** |
**⇒ THIS is why prod has no postseason PA.** The step ran, but the counting stats were never in its write set, so the
Masters still hold whatever an older CSV import left. **VERIFIED:** prod `pa` == staging `regular_season_pa` for
**5,339/5,339 hitters (100.0%)** and prod `IP` == staging `regular_season_ip` for **5,374/5,374 (100.0%)**; **0.0%**
match the full-season values.

## ▶️ THE REQUIRED WORK, IN ORDER
1. **Extend `derive_masters_from_pitchlog.ts` to write the counting stats to EXISTING rows** — `pa`, `ab`, `IP`, `ERA`
   — plus the **reg/post split** into `regular_season_pa` / `regular_season_ip` from `reg_PA` / `reg_IP`.
   Boundary is `scripts/drs/drs_engine/season_config.py` → **`2026: regular_season_end 2026-05-18 / postseason_start
   2026-05-19`**. Per that file's own policy: **player stats + power ratings = FULL season; program analytics =
   REGULAR season; projections target a regular-season line.**
2. **Re-point `populate_descriptive_war.mjs` / `_reg.mjs` at the DB Masters** instead of the CSV sheets. Until this is
   done Track B has no WAR stage.
3. **Add the Master-sheet CHECK/OVERRIDE layer** — monthly CSV compared against the derived values, overriding only
   where the pitch log is known-weak (**SB, ERA**), and **logging every override with both values**.
4. ⛔ **`D33b` / `lock_regular_season` IS OBSOLETE — NOT DEFERRED (Trevor, 2026-08-30).** `derive_masters_from_pitchlog` writes `pa` and `regular_season_pa` in the SAME run from the SAME source row, so the atomicity rule is met structurally and the lock has no remaining purpose. **Retire it.** Original note: That RPC is `regular_season_pa = pa` where
   NULL — a snapshot that only works if `pa` is *already* the regular-season line. It predates the engine's split, has
   **NO unlock**, and running it now would permanently freeze the pre-postseason number into `regular_season_pa` while
   `pa` is about to be rewritten to full-season. **Write both columns from the engine output instead.**

---
# 📐 SCOPE — MAKE `derive_masters_from_pitchlog.ts` FILL THE MASTERS COMPLETELY (2026-08-30). NOT YET BUILT.
**Trevor's priority, in his words:** *"what we definitely need to do though is write the derive masters from pitch log
into the master so it captures everything, recognizes the split between regular season and postseason and how that
stores into things like the team stats that are important, and just make sure every column in the master is being
filled properly — then once that is done bring in the master sheet that includes the postseason (so not the full
regular season named one)."*
★ **WAR RE-POINTING IS EXPLICITLY *NOT* REQUIRED FIRST.** Trevor: *"I don't necessarily think the WAR needs to be
reproduced and it will be mapped in Track B as long as we continue to emphasize what the goal is."* The CSV-reading
WAR stage stays flagged (see the TRACK B BLOCKER block) and is mapped into Track B later. **Do not rebuild it now.**

## THE ORDER (non-negotiable)
```
1. derive_masters_from_pitchlog.ts fills the Masters COMPLETELY from the pitch log,
   with the regular/postseason split, and feeds the team-stat rollups correctly
2. THEN import the POSTSEASON-INCLUSIVE Master sheet  ⚠ NOT "Full Season Hitting Master Stats.csv"
   — that file is the regular-season-named export. Use the one that INCLUDES postseason.
```

## ✅ COLUMN AUDIT — PROD, Season 2026, division='D1' (VERIFIED 2026-08-30)
### `"Hitter Master"` — 83 columns / 5,341 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_pa` · `trackman_pitches` · `dob` · `class_year` | `regular_season_pa` = **THE GAP** (build it). `trackman_pitches` on the HITTER table is a **pitcher concept — vestigial, confirm then ignore/drop**. `dob`/`class_year` are **roster/bio data** (roster scraper), NOT stats — out of scope here. |
| **WRONG WINDOW** | `pa` `ab` (+ the slash line that derives from them) | populated, but holding the **REGULAR-SEASON** line. Must become **FULL season**. Verified: prod `pa` == staging `regular_season_pa` for **5,339/5,339 (100.0%)**. |
| **PARTIAL — BY DESIGN, NOT DEFECTS** | `line_drive`(5163) `avg_exit_velo`(5082) `barrel`(5078) `ev90`(5151) `pull`(5216) `la_10_30`(5078) `gb`(5163) `pop_up`(5163) + their `*_score` + the 4 power ratings (5122–5130) | gated by **`MIN_TRACKED_BIP`** — legitimately null for low-sample hitters. **Do NOT "fill" these.** |
| **PARTIAL — BY DESIGN** | all 15 `blended_*` + `combined_pa`/`combined_seasons` (~1,061) | only players with multi-season history. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,374) `pull_air`(4,367) `pull_air_score`(4,366) | **5,341 − 4,374 = 967 ≈ the `thin(<25 PA)=963`** skipped by `MIN_PA`. These are written ONLY by this producer, so sub-gate players never get them, while `AVG/OBP/SLG` (written elsewhere) are full. ⬜ **DECIDE: is a 25-PA floor correct for `k_pct`/`pull_air`, or should they follow the same rule as the slash line?** |
| **FULL (38)** | identity, slash line, conference, division, the `desc_*` set | ✅ |
### `"Pitching Master"` — 97 columns / 5,375 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_ip` · **`bf`** · `dob` · `class_year` | `regular_season_ip` = **THE GAP**. ★ **`bf` (batters faced) is 0/5,375 yet `pitcher_line.csv` carries `full_BF` and the producer ALREADY selects `bf`** — a free fill that is simply unwired. |
| **WRONG WINDOW** | `IP` · `ERA` | `IP` holds the **REGULAR-SEASON** line (prod `IP` == staging `regular_season_ip` for **5,374/5,374 = 100.0%**). `ERA` is from the stale import. Both are in `PITCHER_UNMAPPED` yet BOTH exist as `full_IP` / `full_ERA`. |
| **PARTIAL — BY DESIGN** | `hard_hit_pct` `barrel_pct` `line_pct` `exit_vel` `ground_pct` `90th_vel` `la_10_30_pct` `stuff_plus`(5251) + scores | sample-gated. Correct. |
| **PARTIAL — BY DESIGN** | 20 `blended_*` + `combined_ip`/`combined_seasons` (~1,658) | multi-season only. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,772) | = the above-gate pitcher count (`MIN_BF=20`). Same open question as the hitter side. |
| **FULL (56)** | identity, rate stats, `desc_*`, `trackman_pitches` (C24), conference | ✅ |

## 🔧 THE BUILD — WHAT TO WRITE, AND FROM WHERE (every input already exists, all pitch-log-derived)
| Master column | source | file/table | window |
|---|---|---|---|
| `pa` `ab` | `PA` `AB` | `scripts/drs/output/hitter_accrued.csv` | **FULL** |
| `regular_season_pa` | `reg_PA` | same file | **REG (≤2026-05-18)** |
| `IP` | `full_IP` | `scripts/drs/output/pitcher_line.csv` *(or `pitch_log_pitcher_totals.ip`)* | **FULL** |
| `regular_season_ip` | `reg_IP` | `pitcher_line.csv` | **REG** |
| `ERA` | `full_ERA` | `pitcher_line.csv` (`reg_ERA` also present) | **FULL** |
| `bf` | `full_BF` | `pitcher_line.csv` | **FULL** |
| rates + batted-ball | already written | `pitch_log_{hitter,pitcher}_totals` | FULL |
| `G` `GS` | ⬜ **no pitch-log source found** | — | Master-override only |
| SB / CS | ⬜ partial | — | **Master-override BY DESIGN** |
**BOUNDARY (single source of truth):** `scripts/drs/drs_engine/season_config.py` →
`2026: regular_season_end "2026-05-18", postseason_start "2026-05-19"`. Its own policy, verbatim: *player stat store +
player TOTAL WAR + POWER RATINGS = **FULL** season · PROGRAM ANALYTICS (team_war_snapshots, YoY/championship) =
**REGULAR** season · PROJECTIONS target a **regular-season** line.* ⬜ **Mirror this into a DB `season_config` row so
TS and Python share ONE value** — the file itself flags this as unresolved.

## ⬇️ DOWNSTREAM — "how that stores into things like the team stats"
`refresh_team_season_stats(p_season, p_reg_end DEFAULT <season>-05-18)` already takes the boundary and already builds
`_reg` **and** `_total` variants. It reads Master `desc_*`/`_reg` (done ✅) **and divides by `regular_season_ip`**
(`:143` `nullif(sum(pm.regular_season_ip),0)`) — **currently 0/5,375, so every regular-season rate it computes lands
NULL, silently.** ⇒ **Filling `regular_season_ip` is a HARD PREREQUISITE for F44.** Per policy, team analytics use the
REGULAR-season window, which is exactly why this column matters.

## 🛑 GUARDRAILS FOR THE BUILD
1. **`--create-new` is BROKEN** — `:465` passes `"batting_team_id"` where `repRows`' `idCol` belongs, the query times
   out over 2,576,146 rows, and `:451` discards the `error`. **Fix before relying on any new-row path.**
2. **Never create Master rows implicitly** — keep creation behind `--create-new`, log every row by name + PA/IP.
3. **Adopt the `TeamID` a player's teammates already use** — resolving it independently by season splits the team
   (proved live: Arkansas 308→309 teams). Prefer the season-stable `source_team_id` for any rollup.
4. **Do NOT run `lock_regular_season` / D33b.** It is `regular_season_pa = pa` where NULL, has **no unlock**, and would
   freeze the pre-postseason number. **Write both columns from the engine output instead.**
5. **Gate on VALUE + MEMBERSHIP + CARDINALITY, never counts.** After the build: `pa` avg must move ~121.8 → ~128.0;
   `regular_season_pa` must equal the OLD `pa` per player; `regular_season_ip` 0 → 5,374.

---
# ✅ DECISION — DO **NOT** ADD REGULAR-SEASON STAT COLUMNS. Only `regular_season_pa` / `regular_season_ip`. (Trevor, 2026-08-30)
> *"We don't really need regular season stats — we kinda just need WARs from them, and I don't think it displays
> anything except including the postseason data… my main concern was more about what we actually need for the regular
> season, which was the metrics that go into WAR — which we have."*

## WHAT EXISTS, AND WHY THAT IS ENOUGH
| table | `_reg` columns | nature |
|---|---|---|
| `"Hitter Master"` (7 of 83) | **`regular_season_pa`** · `woba_reg` `wraa_reg` `desc_owar_reg` `d_war_reg` `bsr_war_reg` `total_desc_war_reg` | **1 stat anchor + 6 WAR OUTPUTS** |
| `"Pitching Master"` (6 of 97) | **`regular_season_ip`** · `desc_ra9_reg` `desc_fip_ra9_reg` `drs_behind_reg` `desc_pwar_reg` `total_desc_war_reg` | **1 stat anchor + 5 WAR OUTPUTS** |
There is **NO** regular-season `AVG/OBP/SLG/ISO`, no reg `H/2B/3B/HR/BB`, no reg `ERA/FIP/WHIP/K9/BB9/HR9`. **That is
CORRECT and intentional.** The regular-season WAR is already computed and stored; the reg *inputs* are consumed at
compute time from the engine output and do not need persisting.
⚠ The engine produces **28** `reg_*` values that have no Master column and are discarded each run —
`hitter_accrued.csv` (10): `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH`;
`pitcher_line.csv` (18): `reg_IP reg_BF reg_K reg_BB reg_HBP reg_H reg_HR reg_ER reg_ERA reg_R reg_RA9 reg_FIP
reg_WHIP reg_K9 reg_BB9 reg_HR9 reg_K_pct reg_BB_pct`. **Leave it that way unless a display need appears.**
Downstream already copes: `refresh_team_season_stats(p_season, p_reg_end)` **re-derives** regular-season team rates
straight from `pitch_log` by date; it only reads `desc_*_reg` + `regular_season_ip` from the Masters.

## 🛑 BUILD HAZARD — WRITE `regular_season_pa`/`_ip` IN THE **SAME OPERATION** THAT MAKES `pa`/`IP` FULL-SEASON
The three live consumers all use the same fallback:
```
useTeamBuilderData.ts:239   Number(r.regular_season_pa ?? r.pa ?? r.ab)     ← hitter depth-role tier volume
useTeamBuilderData.ts:254   Number(r.regular_season_ip ?? r.IP)             ← pitcher depth-role tier volume
usePitchingSeedData.ts:124  r.regular_season_ip ?? r.IP
refresh_team_season_stats.sql:143,145   ÷ sum(regular_season_ip)
```
Purpose, per `AdminDashboard.tsx:4072`: *"tier classification … stays anchored to regular-season volume. Postseason
games keep updating live pa/IP but tiers stay frozen — **playoff teams don't get inflated tier counts.**"*
**TODAY:** `regular_season_pa` is NULL ⇒ everything falls through to `?? pa` ⇒ and prod's `pa` *happens* to be the
regular-season line ⇒ **tiers are accidentally correct.**
**THE TRAP:** the instant `pa`/`IP` become FULL-season while `regular_season_*` is still NULL, that same fallback
starts using **postseason-inflated volume** ⇒ **deep-run playoff teams get their hitters/pitchers pushed up a depth
tier**, with **no error anywhere**. It is the exact failure the lock mechanism was built to prevent, re-introduced by
filling the wrong column first.
✅ **RULE: one operation, both columns, or neither.** Order within the build: write `regular_season_pa = reg_PA` and
`regular_season_ip = reg_IP` **BEFORE or ATOMICALLY WITH** `pa = PA` / `IP = full_IP`.
✅ **GATE:** after the build, `regular_season_pa` must equal the OLD `pa` per player (prod's current values), and `pa`
must have risen (avg **121.8 → ~128.0**). Spot-check a deep playoff team (LSU / Arkansas) and confirm its depth-role
tier counts did **not** change.
⛔ Still **DO NOT** run `lock_regular_season` / D33b — it snapshots `pa → regular_season_pa`, which is only valid while
`pa` is the regular-season line, and it has **no unlock**.

---
# ✅ THREE BUILD DECISIONS LOCKED (Trevor, 2026-08-30) — these define how `derive_masters_from_pitchlog.ts` is extended
## 1. THE ATOMICITY REQUIREMENT IS SATISFIED BY CONSTRUCTION — `lock_regular_season` BECOMES OBSOLETE
> *"which would just simply be the derive masters from pitch log correct?"* — **YES.**
Because this ONE producer writes `pa`/`ab`/`IP`/`ERA` **and** `regular_season_pa`/`regular_season_ip` in the **same
run, from the same source row** (`hitter_accrued.csv` gives `PA` + `reg_PA`; `pitcher_line.csv` gives `full_IP` +
`reg_IP`), the "one operation, both columns, or neither" rule is met **structurally** — there is no window in which
`pa` is full-season while `regular_season_pa` is still NULL, which is the state that would silently inflate
depth-role tiers for playoff teams.
⛔ **THEREFORE `lock_regular_season` / D33b IS NOT DEFERRED — IT IS OBSOLETE.** It is a pre-engine snapshot mechanism
(`regular_season_pa = pa` where NULL, **no unlock**) that only works while `pa` is the regular-season line. Once this
build lands it must never be run. **Retire it alongside `team_drs_store.sql`.**

## 2. `k_pct` / `pull_air` — FILL FOR EVERYONE, FOLLOWING THE SLASH LINE
> *"follow the slashline and fill it for everyone."*
**Today:** `k_pct` **4,374** / `pull_air` **4,367** of **5,341** hitters (pitcher `k_pct` 4,772 of 5,375) — the
shortfall is exactly the `thin(<25 PA)=963` skipped by `MIN_PA`, while `AVG/OBP/SLG/ISO` show **full** coverage only
because they were last written by the older CSV import.
🛑 **THE GATE MUST BE SPLIT IN TWO — it currently gates the WHOLE patch at `:274`:**
```ts
:274  if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }   // ← PATCH gate: REMOVE / set to 0
:469  if ((t.pa ?? 0) < MIN_PA) { skipped++; continue; }      // ← NEW-ROW gate: KEEP at 25 PA / 20 BF
```
**PATCHING an existing row: no floor** — every player with pitch-log data gets every derived field.
**CREATING a new row: keep the floor** — otherwise `--create-new` manufactures a Master row for every 1-PA appearance
(on prod that would be **763 candidates instead of 1**; the background orphans top out at 18 PA).
⚠ **Once this producer is the SOLE writer, leaving the patch gate at 25 would strand ~963 hitters + ~603 pitchers on
permanently stale CSV values.** Sample-gated batted-ball fields (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, …)
keep their own `MIN_TRACKED_BIP` floor — that is a DATA-QUALITY floor, not a volume floor, and is correct.

## 3. `--create-new` STAYS IN THE PIPELINE — AND ITS BUG IS NOW REQUIRED WORK
> *"keep create new in pitch log track b… we are gonna NEED it in Track B because 2027 will have a bunch of new
> players when Track B runs for the first time in a regular season and will have to do it. It actually makes more
> sense to have it built in that process to ensure it's done properly."*
New-row creation is a **first-class Track B stage**, not a manual patch: at the start of each season virtually every
freshman/transfer appears in the pitch log before any Master sheet arrives, and Track B ingests pitch logs **daily**
vs master sheets **monthly** — so the pipeline MUST be able to create the row itself.
🔴 **THEREFORE THE `repRows` BUG IS BLOCKING, NOT OPTIONAL:** `:465` passes `"batting_team_id"` where `idCol` belongs
(`:486` correctly passes `"pitcher_id"`), so it queries `pitch_log WHERE batting_team_id = <a player id>` — matches
nothing, **exceeds the statement timeout** over 2,576,146 rows, and `:451` **discards the `error`** ⇒ every hitter
silently skipped ⇒ **no hitter Master row can EVER be created.** Left unfixed, Track B's first 2027 run creates **zero
hitters** and reports `0 new rows` with **exit 0**.
**FIX:** `:465` → `"batter_id"`, **and** `:451` → `const { data, error } = …` with failures counted + fatal.
**GATE:** after the fix, a prod dry-run must report **exactly 1** new hitter (Kozeal was already inserted manually, so
re-verify against the current membership query) and the MEMBERSHIP query must come back EMPTY.

---
# 🅱️🏛️ TRACK B — THE COMPLETE ARCHITECTURE (CANONICAL, 2026-08-30). Build from THIS. Zero ambiguity intended.
Settled with Trevor across this session. **Every statement below is a DECISION, not a proposal.** Where something is
genuinely undecided it is marked ⬜ OPEN. Where something is verified on prod it says VERIFIED.

## 1. THE TWO CADENCES — everything else follows from this
| source | cadence | role |
|---|---|---|
| **Pitch log** | **DAILY, all spring** | **PRIMARY SOURCE OF TRUTH.** The majority of every statistic is DERIVED from it. |
| **TruMedia Master sheet** | **~MONTHLY** | **SECOND SOURCE / CHECK.** Overrides the derived value ONLY where the pitch log is known-weak — **stolen bases, ERA, G/GS**. Never a daily dependency. |
⇒ **NO STAGE MAY DEPEND ON A FILE THAT ONLY ARRIVES MONTHLY.** Any stage reading `docs/drs-reference/*.csv` or
`scripts/drs/output/*.csv` is structurally unrunnable inside Track B.

## 2. THE THREE LAYERS — each value lives in EXACTLY ONE place
```
   ┌── LAYER 1 ── pitch_log ─────────────────────────────────────────────────────┐
   │  raw per-pitch. Never aggregated in place. Immutable history.               │
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  REBUILT ON **EVERY** PITCH-LOG IMPORT
   ┌── LAYER 2 ── pitch_log_*_totals ── THE ACCUMULATOR ─────────────────────────┐
   │  ALL RAW COUNTS live here and ONLY here, per (player, season, dimension_key)│
   │  hitter: pa ab hits_single/double/triple/hr k bb hbp sac batted_* ev_* …    │
   │  pitcher: total_bf total_pa total_k total_bb total_hbp hits_*_allowed ip …  │
   │  + defensive/baserunning run values (batting_rv, defensive_rv, baserunning_rv)│
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  DERIVE (rates, ratings, WAR)
   ┌── LAYER 3 ── "Hitter Master" / "Pitching Master" ── DERIVED + DISPLAY ──────┐
   │  rates (AVG/OBP/SLG/ISO, K9/BB9/HR9/WHIP/FIP), power ratings, stuff_plus,   │
   │  desc_* and desc_*_reg WAR, plus pa/ab/IP + regular_season_pa/_ip as the    │
   │  DISPLAY + DEPTH-ROLE-TIER anchors.                                         │
   │  ⛔ NO raw component counts here (no H/2B/3B/HR/BB/HBP columns) — they live  │
   │     in Layer 2. Storing them twice is exactly what we are eliminating.      │
   └─────────────────────────────────────────────────────────────────────────────┘
```
**★ WAR READS LAYER 2 AND WRITES LAYER 3.** That is the resolution of "WAR must read the Masters": the *counts* come
from the accumulator, the *results* land on the Master, and every consumer downstream reads the Master.
**★ `pitch_log_*_totals` IS NOT AN END-OF-SEASON ARTIFACT.** It was built that way only because the season was already
over. **It must rebuild on every import** — it is the mechanism by which pitch-log data reaches the Masters.

## 3. THE REGULAR/POSTSEASON SPLIT — LOCK ONCE AT THE TRANSITION, THEN KEEP ACCUMULATING
> Trevor: *"we also probably just need to recognize the one time in the year when it transitions to the postseason and
> lock in the regular season values, then just keep adding what becomes postseason values."*
```
during the regular season   →  totals accumulate normally
AT THE TRANSITION (one time)→  SNAPSHOT the regular-season line   (dimension_key='reg', or the *_reg columns)
after the transition        →  'all' KEEPS GROWING (full season);  'reg' NEVER CHANGES AGAIN
```
This is the *correct* form of what `lock_regular_season` was groping at — but driven by the accumulator, not by copying
`pa` into `regular_season_pa`. **⛔ `lock_regular_season` / D33b IS OBSOLETE. Retire it.**
**Boundary:** `2026-05-18` (regular_season_end) / `2026-05-19` (postseason_start).
🛑 **IT IS CURRENTLY TYPED IN TWO PLACES** — `scripts/drs/drs_engine/season_config.py` and
`refresh_team_season_stats`'s `p_reg_end` default. **THERE MUST BE ONE SOURCE.** Two copies can drift and nothing
errors. ⬜ **FUTURE (Trevor's plan):** load **per-team SCHEDULES** for upcoming seasons so the system knows when each
team's regular season ends — which removes the constant entirely and handles teams whose seasons end on different
dates. Not urgent; wire the single source first.
**Policy (from `season_config.py`, unchanged):** player stats + power ratings = **FULL** season · program analytics
(`team_war_snapshots`, YoY/championship) = **REGULAR** season · projections TARGET a regular-season line.

## 4. 🔴 WHAT MUST BE BUILT — THE GAP INVENTORY (exact columns, VERIFIED on prod 2026-08-30)
### 4a. `pitch_log_pitcher_totals` (51 cols) IS MISSING THE RUN-PREVENTION INPUTS
HAS: `total_bf total_pa total_k total_bb total_hbp hits_{single,double,triple,hr}_allowed total_ab ip batted_* ev_* stuff_plus_sum`
**MISSING — and `desc_ra9` / `desc_pwar` cannot be computed without them:**
| missing | why it matters | note |
|---|---|---|
| **`R`** (total runs allowed) | `desc_ra9 = 0.5·(RA9 + drs_behind_per9) + 0.5·(FIP·E2T)` | ⚠ **NOT a naive count** — the engine accrues it with **inherited-runner attribution, earned + unearned** (`pitcher_line.csv` `full_R`). **That accrual logic must move INTO the totals build.** |
| **`ER`** (earned runs) | `ERA` | same accrual |
| **`G` / `GS`** | roster/role context | ⬜ Trevor: *"almost positive the pitch log import has a starting pitcher id"* — derivable, **not worth chasing now. Track B flag.** |
### 4b. DEFENSE + BASERUNNING SHOULD FOLD INTO THE SAME ACCUMULATOR
> Trevor: *"same could be said for storing baserunning and defensive values in that same run that might be a separate
> table now — those should all go into the pitch_log_*_totals then that should be derived into the masters from every
> pitch log imported."*
Today they are **separate tables** rebuilt by an offline Python engine:
`player_season_defense` (32 cols — `drs_floor/total/ceiling`, `range_*`, `arm_runs`, `framing_runs`, …) and
`player_season_baserunning` (15 cols — `sb cs sbh wsb_runs` **+ `wsb_runs_reg`** ← *a reg variant already exists here*).
★ **PRECEDENT ALREADY IN PLACE:** `pitch_log_hitter_totals` already carries **`batting_rv`, `defensive_rv`,
`baserunning_rv`** (+ `_z`), written by `populate_hitter_run_values(season)`. So the bridge exists — it just runs as a
separate step instead of as part of the accumulator.
⬜ **OPEN — Trevor's direction is clear (fold them in); the sequencing is not decided.** dRS is a heavy engine with its
own constants; whether it becomes a stage of the daily run or stays a periodic rebuild feeding the accumulator needs a
call. **Do not assume either.**
### 4c. `derive_masters_from_pitchlog.ts` — the extension already scoped
Write to EXISTING rows: `pa`/`ab` (FULL), `IP` (FULL), `ERA`, `bf`, **and** `regular_season_pa`/`regular_season_ip`
**in the same operation** (see the depth-role tier hazard). Split the gate: **no floor for PATCHING** (`:274`),
**keep 25 PA / 20 BF for CREATING** (`:469`). Fix `repRows` `:465` → `"batter_id"` and stop discarding `error` at `:451`.

## 5. ✅ WHAT IS ALREADY CORRECT — DO NOT RE-TEST, DO NOT "FIX"
- **Rates + batted-ball/discipline on both Masters** — already pitch-log-derived and written; the prod dry-run reports
  **0 changes** on 4,373 hitters / 4,772 pitchers. Correct.
- **`desc_*` and `desc_*_reg` WAR on prod** — D31/D32 committed, D34 passed all 9 gates. Values verified against
  staging (`desc_owar` 0.3458 vs 0.3456, sum identity 0.001). **Correct, even though SOURCED from CSVs** — that is a
  Track B wiring problem, not a data problem. **Do not recompute.**
- **`team_drs`** — derived on prod, 308 teams, sum 0.00. **Correct.**
- **Park factors + `run_env_factor`** — prod↔staging **308/308 IDENTICAL**, `run_env_factor` identical at 99.719.
- **Sample-gated columns** (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, the `*_score` set, power ratings) — null
  below `MIN_TRACKED_BIP` **by design**. ⛔ **NOT a gap. Do not fill.**
- **`blended_*` + `combined_*`** (~1,061 hitters / 1,658 pitchers) — multi-season players only, **by design**.

## 6. ⚖️ ROADBLOCKS vs NOT-WORTH-FIXING
| item | verdict |
|---|---|
| WAR reads CSVs, not the DB | 🔴 **ROADBLOCK for Track B** — but NOT for the current prod push. Re-point during the Track B build, not now. |
| `pitch_log_pitcher_totals` missing `R`/`ER` (+ the inherited-runner accrual) | 🔴 **ROADBLOCK** — no pitcher WAR without it. |
| `repRows` `:465` bug (no hitter row can ever be created) | 🔴 **ROADBLOCK** — 2027's first run is mostly new players. |
| `regular_season_pa`/`_ip` unfilled | 🔴 **ROADBLOCK for F44** (`nullif(sum(regular_season_ip),0)` → NULL rates) **and a live hazard** the moment `pa` goes full-season. |
| `pa`/`IP` holding the regular-season line | 🟡 **Fix in the build.** Harmless today *because* `regular_season_*` is NULL and the fallback lands on the right value. |
| Boundary date typed in 2 places | 🟡 **Wire to one source — not urgent.** Superseded later by per-team schedules. |
| `G`/`GS` with no pitch-log source | 🟢 **NOT worth chasing now.** Master-override; Track B flag. |
| SB / CS | 🟢 **Master-override BY DESIGN.** Not a gap. |
| `dob` / `class_year` empty | 🟢 **Not stats.** Roster-scraper concern, out of scope. |
| `trackman_pitches` on `"Hitter Master"` | 🟢 **Vestigial** (a pitcher concept). Confirm, then ignore or drop. |
| `k_pct` / `pull_air` short by ~963 | 🟡 **Fix via the patch-gate removal** — fill for everyone, following the slash line. |
| Reg-season STAT columns beyond `pa`/`IP` | 🟢 **DECIDED: do not add.** Counts live in Layer 2; the Master stores derived results only. |
| Recomputing prod WAR | 🟢 **NOT needed.** Values verified correct. |

## 7. 🧭 THE FOUR GATE TYPES THAT ACTUALLY CATCH THINGS (a count gate catches none of them)
1. **VALUE** — did the number CHANGE? (Conference `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719, both **30/30 before AND after**)
2. **MEMBERSHIP** — diff the ID SET. (caught Kozeal: 5,340 = 5,340 passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams). (caught the `TeamID` split; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code. (`0 FAILED` must be printed, not inferred; `--create-new` exits 0 while creating nothing)

---
# 📍 WHERE WE ARE — END OF 2026-08-30. Current state, and what is left.
## ✅ DONE ON PROD (verified in the DB, not from logs)
| phase | state |
|---|---|
| **A / B** schema + config | ✅ `model_config` 220 keys · Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504) |
| **C** Stuff+ chain 1–5 | ✅ 2,013,005 pitches · per-pitcher gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging** |
| **C24 / C27 / C26 / C29 / C28 (4 steps) / C28b** | ✅ all applied; Conference `Stuff_plus` **101.17 → 99.15** (the lane fix) |
| **D29b** `team_drs` | ✅ **DERIVED on prod** (not pasted) — 308 teams, sum 0.00, Arkansas 41.272 |
| **D30** dRS/wSB load | ✅ confirmed NO-OP (13,454 / 10,432 already present) |
| **D31 / D32** descriptive WAR + `_reg` | ✅ committed, `0 FAILED`; **D34 passed all 9 gates** |
| **E2** park factors + ★`derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full; `run_env_factor` **101.879 → 99.719** |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341** |
**Prod↔staging where compared:** park factors **308/308 identical** · `run_env_factor` identical · Kozeal's WAR
identical to 3dp. Remaining diffs (`hitter_talent_plus` 99.23 vs 99.01) are **staging being BEHIND** — prod is current.

## ⛔ NOT DONE, AND DELIBERATELY SO
- **`D33b` / `lock_regular_season`** — **OBSOLETE, do not run.** Superseded by the accumulator lock (§3 of the
  architecture). It has **no unlock** and would freeze the pre-postseason number.
- **`pa`/`IP` still hold the REGULAR-SEASON line** — harmless *today* precisely because `regular_season_*` is NULL and
  the depth-role fallback lands on the right value. **Fixed in the derive_masters build, both columns together.**
- **WAR still sourced from CSVs** — correct numbers, wrong wiring. **Re-point during the Track B build, not now.**

## ▶️ REMAINING PROD PUSH (dependency order, NOT topic order)
`F44 refresh_team_season_stats` ← **BLOCKED on `regular_season_ip`** (it divides by it → NULL rates) →
`E35` TWP detector (guard added ✅) → `E36/E37/E38` precomputes → `F39` `refresh_composite_war` → `F40–F43` →
`G46` edge-fn deploy → PR staging→main → `H` drops → **THEN staging catch-up, run THROUGH Track B.**
★ **F44 MOVED UP, before Phase E** — `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` READ
`team_season_stats.faced_*` and coerce a miss to `[]`. See the ORDER AUDIT.

## 🔨 THE BUILD QUEUE (in order, all scoped, none started)
1. **`derive_masters_from_pitchlog.ts` extension** — counting stats + reg/post split + gate split + `repRows` fix.
2. **`pitch_log_pitcher_totals` gains `R`/`ER`** — including the inherited-runner accrual currently only in the engine.
3. **`dimension_key='reg'`** on the totals build → kills the last hitter-side CSV dependency.
4. **Fold defense/baserunning into the accumulator** ⬜ sequencing OPEN.
5. **Re-point WAR at the DB** (Layer 2 → Layer 3).
6. **One boundary-date source** → later, per-team schedules.

## 🧠 THE SIX DEFECTS THIS PUSH FOUND — every one PASSED a naive check
1. Conference `Stuff_plus` **stale at 30/30** (a 4th producer the runbook omitted)
2. `trackman_pitches` **fully populated from the WRONG LANE** (638/5,367 = 11.9% agreement)
3. `run_env_factor` **stale under E2 at 30/30** (park rewrite invalidates it)
4. **Kozeal missing** — invisible to `5,340 = 5,340`
5. **`--create-new` structurally broken** — exits 0, prints `0 new rows`, can never create a hitter
6. **`TeamID` team split** — both buckets internally consistent, Σ-centering held **at 309 teams**

---
# 🚦 PUSH-TO-PROD ROADBLOCKS — WHAT ACTUALLY BLOCKS FINISHING THE PUSH (2026-08-30)
**Scope: THE PROD PUSH ONLY.** Track B build work is tracked separately (see the TRACK B ARCHITECTURE block) and is
**NOT** a push blocker. Readiness swept script-by-script, verified — not reasoned from memory.

## 🔴 GENUINE BLOCKERS — must be handled before/while running the remaining steps
| # | blocker | detail | fix |
|---|---|---|---|
| 1 | **F40 `backfill-snapshot-total-hitter-war.ts` HAS NO ENV GUARD** | `:22` `createClient(process.env.SUPABASE_URL!, …)` with **no `--prod` flag anywhere** (`grep -c` = 0/0). `--env-file=.env.production.local` writes PROD with **zero opt-in**. **SIXTH instance** of this defect class (after `_run_store_no_propagate`, both C28 producers, the market scripts, E35, E2). | Add the standard double-keyed guard + verify both refuse paths. ~5 min. |
| 2 | **F44 will write NULL regular-season rates** | `refresh_team_season_stats.sql:143,145` divide by `sum(regular_season_ip)`, which is **0/5,375 on prod** ⇒ `nullif(...,0)` → NULL ⇒ `ra9_r` / `fra9_r` and the `_reg` rate set land NULL, **silently**. | ⚠ **NOT a hard block** — see below. Run F44 now, **re-run after** the `derive_masters` build fills `regular_season_ip`. The function is idempotent (DELETE-season-then-rebuild). |

## ✅ WHY BLOCKER 2 DOES NOT STOP THE PUSH
`faced_stuff_plus` / `faced_htp` — the columns Phase E actually reads — are built by **steps 8 and 9** of
`refresh_team_season_stats`, which join `pitch_log` to the conference Stuff+/HTP. **They do NOT depend on
`regular_season_ip`.** So F44 run today still correctly unblocks `precompute-transfer-projections.ts:225` and
`precompute-pitchers.ts:279`. Only the **program-analytics `_reg` rates** are degraded, and those feed YoY /
championship-benchmark displays, not projections. **Run it, note the gap, re-run later.**

## ✅ NOT BLOCKERS — verified ready (do NOT re-check, do NOT "fix")
| step | state |
|---|---|
| **E35** TWP detector | guard **ADDED + both refuse paths verified** ✅ |
| **E36 / E37 / E38a / E38b** precomputes | all carry the prod ref assert (`grep` = 1) + ordered pagination ✅ · `customer_teams` = **14 active** (NOT 18 — that is a staging number) |
| **F41a / F41b / F41c** TWP markets | ref asserts present ✅ (the earlier "no `--prod`" note is STALE). ⚠ invoke directly — **not npm scripts**. F41b's unordered `.range()` is **benign**: its reads are `players is_twp=true` (253), `target_board` (184), `"Teams Table"` (774) — all single-page. Re-check only if any crosses 1000. |
| **F42a / F42b / F42c** resyncs | ref asserts present ✅ (the "hardcoded `.env.local`" note is STALE — F42a is env-driven + double-key-guarded). ⚠ **F42a needs `--all`** — its default scope is a **staging** build id (0 rows on prod). |
| **F43a / F43b** snapshots | **SAFE BY CONSTRUCTION** — `--prod` SELECTS the env file and they read it directly, so `--env-file` cannot redirect them and prod is unreachable without `--prod`. No ref assert, but no exposure. |
| **F39** `refresh_composite_war()` | already **÷13.1** on prod and runs ✅. 🛑 fire from the **direct pg session / SQL editor only** — over PostgREST the ~125s gateway cuts it and the whole UPDATE **ROLLS BACK**. |
| **G46** edge-fn deploy | gate is now only "F44 has RUN and POPULATED `team_season_stats`" — the table + function **exist** on prod. |

## 🟢 EXPLICITLY NOT PUSH PROBLEMS (correct as-is — keep going, do not edit)
- **`pa` / `IP` holding the regular-season line.** Depth-role tiering reads `regular_season_pa ?? pa`; `regular_season_pa`
  is NULL so it falls through to `pa` — which **IS** the regular-season line. **The tiers are CORRECT today.** This
  only becomes a hazard when `pa` goes full-season, which happens in the derive_masters build where both columns are
  written together. **Nothing to do for the push.**
- **WAR sourced from CSVs.** Numbers **verified correct** (D34 all 9 gates; Kozeal matches staging to 3dp). Wrong
  *wiring*, right *values*. **Do NOT recompute.** Re-point during the Track B build.
- **`repRows` `:465` bug.** Affects only **new-row creation**, which the push does not use. Track B blocker, not a push one.
- **`G`/`GS`, SB/CS, `dob`/`class_year`, `trackman_pitches` on Hitter Master.** Out of scope / by design / vestigial.
- **Everything already applied** — Stuff+ chain, C24/C26/C27/C28/C28b/C29, D29b–D34, E2 + the `derive_conf_opr_htp`
  re-run, Kozeal's row. **Verified. Do not re-run or re-test.**

## ▶️ THE REMAINING PUSH, READY TO EXECUTE (dependency order)
```
0.  FIX F40's env guard (only genuine code blocker)
1.  F44  refresh_team_season_stats(2026)   ← MOVED UP, must precede Phase E (faced_* reads)
2.  E35  run-twp-recompute --apply --prod   (prod is_twp 137/31,467 → expect a large change)
3.  E36  returner pitchers  →  E37 returner hitters  →  E38 zsh scripts/_run_step2_all.sh --prod
        ⚠ the loop pipes through `grep | head -3` and SWALLOWS EXIT CODES — do not trust "14 teams DONE";
          re-run the dry-run afterwards and require 0 pending per team.
4.  F39  refresh_composite_war()  (direct pg session ONLY)
5.  F40 → F41 → F42 (--all) → F42b → F43
6.  G46  edge-fn deploy (Trevor)  →  preview-verify  →  gh pr create staging→main  →  Trevor merges
7.  H    gated drops  →  THEN staging catch-up, run THROUGH Track B
8.  LATER: re-run F44 once derive_masters fills regular_season_ip (idempotent)
```

---
# 🎯 DIRECTIVE — PROD MUST HOLD **FULL-SEASON** `pa`/`IP` (INCLUDING POSTSEASON), WITH THE REG SPLIT ALONGSIDE
> Trevor, 2026-08-30: *"what we need to do is update prod to reflect full season stats including postseason, which
> means that the engine needs to recognize regular season PA the correct way and fill them with that information."*

## THE TARGET STATE (both columns, ONE operation, from the engine)
| column | value | engine source |
|---|---|---|
| `"Hitter Master".pa` / `ab` | **FULL season, incl. postseason** | `hitter_accrued.csv` → `PA` / `AB` |
| `"Hitter Master".regular_season_pa` | **REG only (≤ 2026-05-18)** | `hitter_accrued.csv` → `reg_PA` |
| `"Pitching Master".IP` | **FULL season, incl. postseason** | `pitcher_line.csv` → `full_IP` |
| `"Pitching Master".regular_season_ip` | **REG only** | `pitcher_line.csv` → `reg_IP` |
| `"Pitching Master".ERA` / `bf` | **FULL season** | `pitcher_line.csv` → `full_ERA` / `full_BF` |
🛑 **WRITE BOTH WINDOWS IN THE SAME OPERATION.** Depth-role tiering reads `regular_season_pa ?? pa` — if `pa` goes
full-season while `regular_season_*` is still NULL, tiering silently uses **postseason-inflated volume** and deep-run
playoff teams get pushed up a tier, with no error. **This is why the engine must supply both, not a snapshot.**

## 📊 THE MEASUREMENT THAT ESTABLISHES THE CURRENT STATE (prod + staging, VERIFIED 2026-08-30)
| comparison | mean \|Δ\| | median | p90 | max |
|---|---|---|---|---|
| **STAGING** `regular_season_pa` vs engine `reg_PA` | 0.858 | **0.00** | 3 | 23 |
| **STAGING** `pa` vs engine `PA` (full) | 0.852 | **0.00** | 2 | 23 |
| **PROD** `pa` vs engine **`reg_PA`** | **0.865** | **0.00** | 3 | 37 |
| **PROD** `pa` vs engine `PA` (full) | **6.567** | 1.00 | 20 | 79 |
| **PROD** `IP` vs engine **`reg_IP`** | **0.402** | 0.30 | 1.03 | 8.03 |
| **PROD** `IP` vs engine `full_IP` | **1.428** | 0.37 | 4.33 | 27.67 |
**CONCLUSIONS:**
1. ✅ **STAGING IS FILLED CORRECTLY** — both windows match their own engine source at **median 0**, correctly paired.
   **Do NOT "fix" staging.** (Trevor was right; my earlier doubt was wrong.)
2. ✅ **PROD's `pa`/`IP` ARE THE REGULAR-SEASON WINDOW** — 0.865 vs 6.567 for PA, 0.402 vs 1.428 for IP. Unambiguous.
3. ✅ The residual **~0.86 PA / ~0.40 IP** is TruMedia counting vs the engine's pitch-log derivation — the same
   effect recorded as **IP corr 0.9932 vs Master IP** in the `team_season_stats` migration. **Expected, not a defect.**
4. ✅ **FILLING `regular_season_pa`/`_ip` FROM THE ENGINE IS LOW-RISK** — the value differs from today's `pa` by a
   **median of 0.00**, so depth-role tiers barely move. **My earlier "this changes 1,306 hitters" warning was WRONG.**

## 🧠 METHODOLOGICAL LESSON — DO NOT COMPARE TWO DERIVATIONS BY EXACT EQUALITY
I first tested prod `pa` == engine `reg_PA` with **exact integer equality** and got **75.5%**, then reported that as
"1,306 hitters would change." **That was a false alarm.** The true distribution is **median 0, mean 0.865**. Exact
equality between two INDEPENDENT derivations of the same quantity will always show a large "mismatch %" that is really
just rounding/derivation noise.
✅ **RULE: when comparing two derivations, report mean/median/p90/max of |Δ| — never a % exact match.**
⚠ **Second occurrence today.** The first was the E2 park-factor diff, where my probe matched the CSV's `teamId`
column instead of `team` and briefly reported "all 309 teams would be dropped" (the truth was **1**: Fort Wayne).
**Both were MY instrument, not the data.** Verify the instrument before reporting an alarm.

## ▶️ EXECUTION (part of the `derive_masters_from_pitchlog` extension — NOT a separate lock step)
1. Write all four columns from the engine in ONE upsert per player.
2. **GATE (values, not counts):** `pa` avg **121.8 → ~128.0** · `regular_season_pa` ≈ today's `pa` (median Δ 0) ·
   `regular_season_ip` **0 → 5,374** · `IP` avg rises · spot-check a deep playoff team (LSU / Arkansas) and confirm
   its **depth-role tier counts do not move**.
3. Then **re-run F44** (`refresh_team_season_stats`) so `ra9_r` / `fra9_r` stop landing NULL. Idempotent.
⛔ **`lock_regular_season` / D33b remains OBSOLETE** — it snapshots `pa`, which is exactly the wrong mechanism.

---
# ✅ STEP 0 DONE — F40 ENV GUARD ADDED (2026-08-30)
`scripts/backfill-snapshot-total-hitter-war.ts` had **no guard of any kind** — it read `process.env.SUPABASE_URL` with
**no `--prod` flag anywhere** (`grep -c` = 0/0), so `--env-file=.env.production.local` wrote PROD with **zero opt-in**;
the only signal was a `host` banner printed AFTER the client was constructed. It writes `team_build_players` +
`target_board` snapshots — **coach-visible build/board data.** **SIXTH instance** of this defect class (after
`_run_store_no_propagate` C26, both C28 producers, the market scripts, `run-twp-recompute` E35, and
`backfill_park_factors_seasonal` E2).
**FIX:** standard double-keyed guard (URL and `--prod` must AGREE) + a resolved-env banner printed BEFORE any work,
+ an explicit missing-credentials check.
**ALL FOUR PATHS VERIFIED:**
```
REFUSE  PROD url, no --prod   → ✗ URL is PROD but --prod was not passed — refusing.
REFUSE  STAGING url, --prod   → ✗ --prod passed but URL is not prod — refusing.
ALLOW   STAGING, no flag      → [env] STAGING/other (slrxowawbijbjrkozqlj)  mode=DRY-RUN
ALLOW   PROD + --prod         → [env] 🔴 PROD (trbvxuoliwrfowibatkm)  mode=DRY-RUN
```
**PROD DRY-RUN (read-only) — F40's actual workload when it runs at STEP 9:**
`d/bsr map: 520 players (of 522 snapshot players)` · **`snapshots to fill: 696`**
⛔ **NOT APPLIED** — F40 runs at STEP 9 of the plan, after the precomputes. This step only added the guard.

---
# 🔴🔴 PROD GAP — `pitch_log.game_string` WAS **0 / 2,576,146**, AND WHAT IT SILENTLY BROKE (2026-08-31)
## THE FINDING
| | PROD | STAGING |
|---|---|---|
| `pitch_log` 2026 rows | 2,576,146 | 2,579,655 |
| **`game_string` populated** | ✅ **2,576,146 (backfilled 2026-08-31)** — was 0 | **2,576,146** |
| `inn` · `outs` · `date` · `pitcher_id` | 2,576,146 each ✅ | ✅ |
**Every other column is fine.** Only `game_string` is empty — and it is **NOT a derived value**. It is an identifier
that arrives WITH the export and is written at INGEST: `scripts/ingest_pitch_log.ts:325`
`game_string: textOrNull(get(row, cols, "gameString"))`. **Prod was loaded from a run that lost that column.**

## 🛑 WHAT IT BREAKS (both silent — neither raises an error)
1. **PER-PITCHER IP (outs ÷ 3) CANNOT BE DERIVED.** The half-inning key is `(game_string, inn)`.
   `scripts/fill_pitcher_totals_ip.ts --prod` derived **0 pitchers** on prod vs **5,415** on staging. It returns an
   empty set, not an error.
2. **`refresh_team_season_stats` STEP 5 (team W/L RECORDS) HAS NOTHING TO KEY ON.** That step states verbatim:
   *"game key = game_string = EXACT game id, doubleheader-safe"*. On prod every key is NULL ⇒ records are wrong/empty
   ⇒ **F44 would have produced a broken records block and reported success.**
★ **THE PHASE-C GATES ALL PASSED WHILE THIS WAS 100% NULL** — the Stuff+ chain, the 48/48 aggregations, C24–C29 and
Phase D never touch `game_string`. It only surfaced when something finally needed it as a KEY. **Another instance of
"a gap stays invisible until a specific consumer needs that exact column."**

## ✅ THE FIX — `scripts/backfill_pitch_log_game_string.ts` (NEW)
Reads the **source export**, not staging: `docs/drs-reference/*DRS Pitch Log*.csv` — **34 files**, `uniqPitchId` (col 7)
→ `gameString` (col 4). ⛔ deliberately NOT copied from staging even though `uniq_pitch_id` matches across
environments — this re-derives from the same source staging was loaded from ([[feedback_derive_over_copy]]).
**DRY-RUN ON PROD:** `read 34 files · 2,652,166 rows · 2,576,230 distinct uniqPitchId · 0 empty gameString` ·
**resolvable 2,576,146 / 2,576,146 = 100.00%**. Spot-check `287772425-23-1 → cs-mur01202602280`, and that row's
`date` is 2026-02-28 — the game string encodes `20260228` ✅.
**SAFETY:** writes only `where game_string is null` (never overwrites) · idempotent · stages the map into a temp table
then does ONE set-based UPDATE (2.5M single-row updates would take hours).
🐛 **FIRST ATTEMPT FAILED — `create temp table … ON COMMIT DROP`.** node-postgres **autocommits every statement**
unless you open an explicit transaction, so the CREATE committed and the table was dropped before the inserts ran
(`relation "_gs_map" does not exist`). **It failed loudly and wrote NOTHING** — prod re-verified at `filled 0`.
✅ Fixed by using a session temp table. **Rule: never use `ON COMMIT DROP` from node-postgres without an explicit BEGIN.**

---
# 🔬 HOW PER-PITCHER IP IS DERIVED — outs ÷ 3, AND THE FOUR WRONG WAYS
Trevor: *"IP is outs total divided by 3 anyway. That's what staging did… there is an outs total in the inning that the
pitch log tracks and you just have to recognize how that changes to get total outs."*
**THE DATA:** `inn` is **TEXT and ALREADY encodes the half** — `'Top 1'` / `'Bot 1'` — so **`(game_string, inn)` IS a
half-inning**; no separate top/bottom key is needed. `outs` is the base-out **STATE BEFORE the pitch** and only ever
holds **0 / 1 / 2** (never 3).
**THE DERIVATION (committed as `scripts/fill_pitcher_totals_ip.ts`):**
```sql
with p as (
  select pitcher_id, outs,
         lead(outs) over (partition by game_string, inn order by uniq_pitch_id) nxt
  from pitch_log where season=2026 and inn is not null and outs is not null)
select pitcher_id, sum(greatest(coalesce(nxt,3) - outs, 0)) / 3.0 as ip from p group by pitcher_id
```
Outs on a play = the NEXT row's `outs` minus this row's, within the half-inning; the final play of a completed
half-inning takes it to 3. **The out is attributed to whoever threw that pitch, so relief appearances split correctly.**
## 📊 ACCURACY — MEASURED AGAINST TruMedia `"Pitching Master".IP` (n=5,377, staging)
| method | mean \|Δ\| | median | verdict |
|---|---|---|---|
| engine `pitcher_line.csv` `full_IP` | **0.411** | 0.30 | best, but CSV-dependent |
| **outs-state delta ÷ 3 (this script)** | **0.476** | **0.33** | ✅ **in-DB, no CSV — chosen** |
| staging's stored `totals.ip` | 0.486 | 0.33 | ← **NOT more correct than a fresh derivation** |
| out-events + Sac, DP=2 | 0.596 | 0.33 | close; misses an out category |
| out-events, DP=2 | 1.260 | 1.00 | |
| attributable `(max+1−min)/3` | — | 1.33 | |
| half-inning `(max+1)/3` | — | 2.67 | ⛔ credits relievers with outs recorded BEFORE they entered |
★ **THE KEY RESULT: this derivation is as accurate as staging's stored column (0.476 vs 0.486, identical medians).**
Staging's `ip` is an **ad-hoc artifact with NO committed producer** — I burned significant effort trying to reproduce
it exactly before realising **matching it was never the goal**; reproducing a correct outs÷3 is.
All methods sit within the ~0.99 correlation this measure carries by design (`refresh_team_season_stats.sql:119`
records **corr 0.9932 vs Master IP**).
**GUARD:** the script ABORTS if mean |Δ| vs the Master line exceeds 1.0 IP — a bad derivation cannot write.
**BOTH WINDOWS IN ONE PASS:** the regular-season split comes from the date parsed out of `game_string`
(`…20260328…`) vs `regular_season_end` — so `ip` and the new `ip_reg` are produced together, no CSV needed.

---
# 📋 THE COMPLETE FILL LIST — WHAT MUST BE POPULATED, WHERE IT COMES FROM, AND ITS STATE
## LAYER 2 — `pitch_log_*_totals` (THE ACCUMULATOR — rebuilt on EVERY import)
| table.column | source | PROD state | note |
|---|---|---|---|
| `pitch_log_pitcher_totals.ip` | outs÷3 from `pitch_log` | ✅ **5,415 (filled 2026-08-31)** | required `game_string` first |
| `pitch_log_pitcher_totals.ip_reg` | same, ≤ boundary | ✅ **column added + 5,415 filled (2026-08-31)** | |
| `..._pitcher_totals.R` / `ER` | ⬜ **NOT BUILT** | ❌ absent | ⚠ needs the engine's **inherited-runner attribution, earned+unearned** — NOT a naive count. Blocks pitcher WAR from the DB. |
| `..._pitcher_totals` counts (`total_bf/pa/k/bb/hbp`, hits, batted-ball, `stuff_plus_sum`) | aggregator | ✅ 5,509 | |
| `pitch_log_hitter_totals` (`pa ab hits_* k bb hbp sac`, batted-ball, `ev_*`) | aggregator | ✅ 6,099 | full-season `pa`/`ab` verified **median Δ 0.00** vs engine |
| `pitch_log_hitter_totals.batting_rv / defensive_rv / baserunning_rv` | `populate_hitter_run_values` | ✅ | ★ precedent for folding defense/baserunning INTO the accumulator |
| a `reg` window for the hitter side | ⬜ **NOT BUILT** | ❌ | either `dimension_key='reg'` or `*_reg` columns |
## LAYER 3 — the Masters (DERIVED + DISPLAY)
| column | source | PROD state |
|---|---|---|
| `Hitter Master.pa` / `ab` | accumulator (full) | ⚠ holds the **REGULAR-SEASON** line — must become FULL |
| `Hitter Master.regular_season_pa` | engine `reg_PA` / a reg window | ❌ **0 / 5,341** |
| `Pitching Master.IP` | `ip` (full) | ⚠ holds the REGULAR-SEASON line |
| `Pitching Master.regular_season_ip` | `ip_reg` | ❌ **0 / 5,375** |
| `Pitching Master.ERA` | engine `full_ERA` (until `ER` lands in the accumulator) | ⚠ stale CSV |
| `Pitching Master.bf` | `total_bf` | ✅ **5,372 (filled 2026-08-31)** |
| **`K9` `BB9` `HR9` `WHIP` `FIP`** | `pitcherIpDependent()` — **needs `ip`** | ✅ **DERIVED ON PROD 2026-08-31 — 5,375/5,375.** Historical: `pitcherIpDependent` returned `{}` on a null `ip`, so the producer silently skipped them and prod held stale TruMedia values while staging derived them. Fixed by filling `ip` (step 0c) then running step 1. |
| `k_pct` / `pull_air` | accumulator | ⚠ 4,374 / 4,367 of 5,341 — the `MIN_PA` PATCH gate (now removed) |
| rates + batted-ball + `stuff_plus` | accumulator | ✅ (dry-run: 0 changes) |
| `G` / `GS` | ⬜ no pitch-log source found | Master-override. Trevor: *"almost positive the pitch log import has a starting pitcher id"* — Track B flag |
| SB / CS | Master sheet | **override BY DESIGN** |
| `dob` / `class_year` | roster scraper | out of scope |

## ▶️ ORDER (each step unblocks the next — none of these are optional)
```
1. game_string backfill        ← unblocks 2 AND F44's records block
2. fill_pitcher_totals_ip      → ip + ip_reg  (derives 0 pitchers until step 1 lands)
3. derive_masters_from_pitchlog → K9/BB9/HR9/WHIP/FIP finally derive; pa/IP/ERA/bf + regular_season_* written
4. F44 refresh_team_season_stats → _reg rates stop landing NULL; records block works
5. postseason-inclusive Master sheet import = the CROSS-CHECK / OVERRIDE layer
```

---
# 🐛 TWO node-postgres TRAPS THAT EACH COST A PROD RUN (2026-08-31). Exact reproductions.
Both hit while backfilling `pitch_log.game_string` (2,576,146 rows). **Both failed LOUDLY and wrote NOTHING** — prod
re-verified at `game_string filled 0` after each. Recording them precisely because neither is obvious and both will
recur in Track B, which does bulk writes by definition.

## TRAP 1 — `CREATE TEMP TABLE … ON COMMIT DROP` IS DESTROYED IMMEDIATELY
```ts
await c.query(`create temp table _gs_map (…) on commit drop`);   // ← commits, and DROPS, right here
await c.query(`insert into _gs_map …`);                           // ✗ relation "_gs_map" does not exist
```
**WHY:** node-postgres runs every `query()` in its own implicit transaction (autocommit) unless you open an explicit
`BEGIN`. `ON COMMIT DROP` therefore fires the instant the CREATE statement commits — before any INSERT can run.
**FIX:** either wrap the whole sequence in an explicit `BEGIN … COMMIT`, or use a plain session temp table
(`drop table if exists x; create temp table x (…)`), which lives until the connection closes.
**RULE: never use `ON COMMIT DROP` from node-postgres without an explicit transaction.**

## TRAP 2 — A SINGLE BULK `UPDATE` EXCEEDS PROD'S `statement_timeout` AND ROLLS BACK WHOLE
```
FATAL: canceling statement due to statement timeout
```
**PROD `statement_timeout` = `2min`** (verified: `show statement_timeout`). One set-based UPDATE joining 2.5M rows
blew straight through it. Because it is a SINGLE statement it rolled back **entirely** — no partial write, but ~4
minutes of staging work thrown away.
**FIX — batch it, and prefer `unnest()` over a temp table:**
```sql
update pitch_log p set game_string = m.gs
from unnest($1::text[], $2::text[]) as m(upid, gs)
where p.uniq_pitch_id = m.upid and p.season = $3 and p.game_string is null
```
25,000 rows per chunk → **~103 statements, each ~0.25 min**, comfortably under the 2-minute ceiling. This also
removes the temp table entirely, so TRAP 1 cannot recur.
**MEASURED THROUGHPUT ON PROD:** ≈ **87,000 rows/min** (1,175,000 rows in 13.5 min) ⇒ ~30 min for the full 2.58M.
★ **DESIGN THE `WHERE` CLAUSE SO A PARTIAL RUN IS RESUMABLE.** `where game_string is null` means an interrupted run
can simply be re-run — it only touches what is still empty. **A batched write without a resumable predicate is worse
than a single statement**, because a single statement at least rolls back cleanly.

## ⚠ RELATED, ALREADY LOGGED — DO NOT "SOLVE" THIS WITH `statement_timeout = 0`
A previous session set `statement_timeout = 0` for a `--direct` run and **prod hung for 39 minutes with no active
query** — removing the ceiling also removes the failure signal. **Use a FINITE timeout and BATCH.** Same reasoning as
the ~125s PostgREST gateway ceiling that silently rolls back `refresh_composite_war()`.

## 🅱️ TRACK B REQUIREMENT
Track B writes in bulk on every ingest. It MUST: batch every write under the statement timeout · use a resumable
predicate · never rely on `ON COMMIT DROP` · report per-batch progress and a final written count · treat a
swallowed error as a hard stop. All four of these were violated by code found in this push.

---
# ✅ STEP 0b + 0c APPLIED TO PROD (2026-08-31) — `game_string` backfilled, per-pitcher IP derived
## 0b — `pitch_log.game_string` BACKFILL: **0 → 2,576,146 (100%)**
```
✓ updated 2,576,146 rows
AFTER — filled 2,576,146 / 2,576,146 · distinct games 8,519
```
★ **SANITY GATE THAT MATTERS: 8,519 distinct games × 2 team-appearances ÷ 308 D1 teams = 55.3 games/team** — exactly a
~56-game season. A bad join would have produced a nonsense number here; a row count alone would not have caught it.
Source: `docs/drs-reference/*DRS Pitch Log*.csv` (34 files, `uniqPitchId`→`gameString`), **not** copied from staging.
**RUNTIME:** ~30 min at **≈87,000 rows/min**, 103 batches of 25,000. Two failed attempts first (see the node-postgres
traps block) — both wrote NOTHING and prod was re-verified at `filled 0` after each.

## 0c — `pitch_log_pitcher_totals.ip` + NEW `ip_reg`: **0 → 5,415**
```
DERIVED — 5415 pitchers (5382 with IP>0)
  Σ IP 147,630.3   Σ reg 140,202.7   post = 7,427.7 (5.0%)
  vs TruMedia Master.IP — n=5,374  mean|Δ|=0.458  median=0.33  p90=1.33
```
**THREE INDEPENDENT CONFIRMATIONS:** (1) **Σ IP 147,630.3 is IDENTICAL to staging's** — same pitch log, same
derivation, same answer, computed separately; (2) mean |Δ| **0.458** matches staging's **0.476**; (3) the **5.0%
postseason share** is right for conference tournaments + regionals on a 56-game season.
DDL: `alter table pitch_log_pitcher_totals add column if not exists ip_reg numeric`.

## 🛑 THE GUARD FIRED — AND IT WAS RIGHT TO. READ THIS BEFORE LOOSENING ANY THRESHOLD.
The first prod dry-run **ABORTED**: `mean |Δ| = 1.827 > 1.0 — derivation looks wrong`.
**The derivation was fine. The COMPARISON was wrong.**
| prod `"Pitching Master".IP` vs | mean \|Δ\| | median |
|---|---|---|
| derived **FULL** `ip` | **1.827** | 0.67 |
| derived **`ip_reg`** | **0.458** | **0.33** |
**PROD's `Master.IP` HOLDS THE REGULAR-SEASON LINE** (staging's holds FULL). Checking a full-season derivation against
a regular-season column manufactures a false discrepancy.
✅ **FIXED THE COMPARISON, NOT THE THRESHOLD** — the script now checks `ip_reg` by default with a `--cmp-full`
override for once the Masters hold the full-season line. **Loosening the threshold would have written silently and
destroyed the only signal that told us which window prod's Master column is in.**
★ **LESSON: a tripped guard is DATA.** It said "these two numbers disagree" and the disagreement was the real finding.
Compare like with like; never relax a gate to make it pass.

## ▶️ WHAT THIS ARMS (nothing has changed on the Masters yet)
`derive_masters_from_pitchlog` calls `pitcherIpDependent(t, ip)`, which returns `{}` on a null `ip`. With `ip` now
populated it will finally derive **`K9` `BB9` `HR9` `WHIP` `FIP`** on prod instead of silently leaving stale TruMedia
values. **Those five columns do NOT change until STEP 1 runs** — 0c only arms it.
Also unblocked: `refresh_team_season_stats` step 5 (team W/L records), which keys on `game_string`.

---
# ✅ STEP 1 APPLIED TO PROD (2026-08-31) — the Masters now carry FULL-SEASON counting stats + the reg anchors
`derive_masters_from_pitchlog.ts --apply --no-newrows --prod`. Backups: `_hm_prefill_backup` (8,245) ·
`_pm_prefill_backup` (8,071). Changed 3,742 hitters / 5,374 pitchers.

## GATES (prod, 2026, D1) — before → after
| gate | before | after | ✓ |
|---|---|---|---|
| `pa` avg | 121.8 | **127.7** | ✅ full-season |
| `regular_season_pa` | **0** | **5,322** (avg 121.4) | ✅ |
| `regular_season_pa` vs the OLD `pa` | — | **median Δ 0.00** (n=5,322) | ✅ |
| `IP` avg | 25.67 | **26.66** | ✅ |
| `regular_season_ip` | **0** | **5,372** (avg 25.32) | ✅ |
| `bf` | **0** | **5,372** | ✅ free fill, was never wired |
| `K9` / `WHIP` | stale CSV | **5,375 / 5,375 DERIVED** | ✅ ← the gap 0c armed |
| `k_pct` | 4,374 | **5,334** | ✅ patch gate removed |
| **depth-role volume** (`regular_season_pa ?? pa`) | — | **median Δ 0.00** | ✅ tiers stable |

## 🛑 TWO OF MY OWN GATES WERE MISCALIBRATED — THE DATA WAS RIGHT BOTH TIMES
1. **`pull_air` 4,781 (I expected ~5,341).** ❌ my expectation. `pull_air` is gated by **`MIN_TRACKED_BIP`** — a
   DATA-QUALITY floor — not by `MIN_PA`. I had already documented "sample-gated columns: do NOT fill these" and then
   wrote a gate expecting them filled. **4,781 is correct.**
2. **`ERA` avg 8.72 — I called it implausible.** ❌ wrong comparison. It was **8.65 BEFORE**; the raw mean is dominated
   by tiny-IP outliers (Luke Rolland 0.30 IP / 216.0 ERA — pre-existing). The meaningful measure, **IP-WEIGHTED ERA,
   moved 6.10 → 6.12** — essentially unchanged, the sliver being postseason innings.
★ **RULE: for any per-player rate, gate on the IP/PA-WEIGHTED mean, never the raw mean.** A raw mean over a
long tiny-denominator tail is not a league average and will trigger false alarms.

## 🧠 FOUR INSTRUMENT ERRORS IN ONE SESSION — THE PATTERN
Every one was MY measurement, not the data: (1) park-factor diff matched the CSV's `teamId` instead of `team` →
"309 teams dropped" when it was **1**; (2) compared two derivations by EXACT EQUALITY → "1,306 hitters change" when
median Δ was **0.00**; (3) `Number(null) === 0` passed `isFinite` → a fabricated 26.6-IP discrepancy; (4) raw-mean ERA
→ a false regression. **VERIFY THE INSTRUMENT BEFORE REPORTING AN ALARM.** Report mean/median/p90/max — never a
percent-exact-match, and never a raw mean over a skewed denominator.
✅ **The one gate that fired for real** — the IP-fill guard at 1.827 — was RIGHT, and its disagreement was the finding
(prod's `Master.IP` held the regular-season line). **Fix the comparison, never the threshold.**

## ▶️ NEXT
`F44 refresh_team_season_stats(2026)` — now fully unblocked: `regular_season_ip` is populated (its `nullif(sum(...),0)`
no longer yields NULL) **and** `game_string` exists (its records block keys on it). Then E35 → precomputes → F39 → F40–43.
⬜ **Still to come:** the postseason-inclusive Master sheet import, which OVERRIDES where it is more accurate
(SB, ERA, G/GS) — per the derive-then-check order.

---
# ✅ F44 `refresh_team_season_stats(2026)` — APPLIED TO PROD 2026-08-31. Completed in 59.7s.
## GATES — ALL PASS (prod, season 2026)
```
rows 0 → 308                                308
faced_stuff_plus / faced_htp                308 / 308   ← what Phase E actually reads
ra9_reg / fip_ra9_reg                       308 / 308   ← would be NULL without regular_season_ip
AVG 0.277 · wRC+ 98.8 · ERA 6.20 · total_war 15.09
W/L records                                 308 teams · 27.6W-27.4L · 55.0 games
team_drs · ip_total · park snapshot         308 / 308 / 308
Arkansas exactly ONE row                    1
```
★ **THREE GATES ARE DIRECT PAYOFFS FROM TODAY'S EARLIER WORK:**
1. `ra9_reg`/`fip_ra9_reg` = 308 — these divide by `sum(regular_season_ip)` (`:143,:145`), which was **0/5,375 this
   morning**. Without STEP 1 they would ALL have landed NULL, silently.
2. **W/L records = 27.6W-27.4L over 55.0 games** — the records block keys on `game_string`, which was **0/2,576,146**
   this morning. **55.0 games/team independently cross-checks the 8,519 distinct games** from the backfill
   (8,519 × 2 ÷ 308 = 55.3). Two different derivations of season length agreeing.
3. `AVG 0.277` and `wRC+ 98.8` land exactly where the runbook predicted (~.277 / ~100).

## 🛑 F44 FAILED FIRST — A PRIMARY KEY CAUGHT WHAT NO GATE OF OURS WOULD HAVE
```
duplicate key value violates unique constraint "team_season_stats_pkey"
Key (source_id, season)=(3375, 2026) already exists.
```
The function does `GROUP BY "TeamID"` then `JOIN "Teams Table" tt ON tt.id = TeamID` to get `source_id`. **Two
`TeamID`s resolving to ONE `source_id` therefore emit two rows with the same PK.** `team_season_stats` stayed at
**0 rows** — a plpgsql function is atomic, so it rolled back whole.
★ **THE DATABASE CONSTRAINT DID CARDINALITY ENFORCEMENT NO APPLICATION GATE WOULD HAVE.** It refused to write two
Arkansas rows rather than silently producing one. **A PRIMARY KEY IS A CARDINALITY GATE — lean on it.**

## 🔍 ROOT CAUSE — A MANUFACTURED MASTER ROW, NOT A `TeamID` PROBLEM
**My first proposed fix (re-point the `TeamID`) WAS WRONG.** Trevor pushed back — *"I am more worried about the team
id changing and impacting a lot more than we realize"* — and investigating proved him right.
### WHAT THE INVESTIGATION FOUND
| the `TeamID` convention is MIXED, and that is FINE | |
|---|---|
| 2026 Masters pointing at a **2025** Teams-Table row | **254 TeamIDs · 8,794 rows** |
| 2026 Masters pointing at a **2026** Teams-Table row | **55 TeamIDs · 1,922 rows** |
**So 55 teams legitimately use their 2026 id.** Arkansas was not an outlier for using one — it was the **ONLY
`source_id` where BOTH appeared**. The two Arkansas Teams-Table rows are **identical in every field** except `id` and
`Season` (same `source_id`, name, abbreviation, conference, `conference_id`, division), and the 2026 row is genuinely
referenced by **34 `players` rows**. ⛔ **DO NOT "normalize" the 254/55 split — F44 only requires that each
`source_id` resolve to ONE `TeamID`.**
### THE ACTUAL DEFECT — Carson Wiggins (`1583774970`)
| | |
|---|---|
| prod `pitch_log` 2026 | **0 pitches, 0 games** |
| prod `pitch_log_pitcher_totals` | **no row** |
| **staging `"Pitching Master"`** | **DOES NOT EXIST** |
| prod `"Pitching Master"` | 1 row, `IP 14`, `ERA 3.21`, on the 2026 `TeamID` |
A **manufactured row with no season behind it** — Trevor: *"Wiggins was manually added because there was a chance he
was coming back, then he signed."* **DELETED** (backed up to `_pm_wiggins_backup`); his `players` row untouched.
★ **THE KOZEAL/WIGGINS DISTINCTION — THIS IS THE RULE:**
> **Kozeal:** 1,103 pitches, 287 PA of real pitch-log data, **no Master row** → the row was MISSING and had to be created.
> **Wiggins:** a Master row with **ZERO pitch-log data** → the row was PHANTOM and had to be removed.
> **Presence in a season's Master is determined by whether the PITCH LOG shows he played — nothing else.**
### VERIFIED AFTER THE DELETE — **NO `TeamID` CHANGED**
`source_ids served by >1 TeamID: 0` → **308 TeamIDs mapping to 308 distinct source_ids, 1:1.** The mixed 254/55
convention is untouched.

## 🧠 PROCESS NOTES
- **I guessed column names twice** (`ra9_r`, `AVG`) before reading `information_schema`. `ra9_r`/`fra9_r` are the
  function's internal CTE aliases; the TABLE columns are `ra9_reg`/`ra9_total`/`fip_ra9_reg`. **Read the schema; do
  not infer column names from the producing SQL.**
- **`statement_timeout` could NOT be raised via the node-postgres client option** — `show statement_timeout` still
  reported `2min` despite passing `statement_timeout: 900000`. F44 finished in **59.7s** so it did not matter, but for
  anything longer use `set statement_timeout = '15min'` as an explicit statement (a FINITE value — **never 0**).

---
# 🅱️ TRACK B — RULES ADDED 2026-08-31 FROM THE MASTERS/F44 WORK. Build these in from the start.
## 1. ROW EXISTENCE IS DECIDED BY THE PITCH LOG, IN BOTH DIRECTIONS
| case | evidence | action |
|---|---|---|
| **Kozeal** | 1,103 pitches · 287 PA · **no Master row** | **CREATE** the row |
| **Wiggins** | **0 pitches** · no totals row · a Master row exists | **REMOVE** the row |
Track B must handle **both**: create rows for players the pitch log shows played, and flag/remove Master rows with no
pitch-log season behind them. **Neither is decided by returner status, roster status, or portal status.**
⚠ A manufactured row is not harmless — Wiggins' phantom row **hard-blocked `refresh_team_season_stats`** via a PK
violation and would have folded 14 phantom IP into Arkansas's team rollups had it been "fixed" by re-pointing.

## 2. `TeamID` IS A SEASONED KEY — GROUP ON `source_id`, NOT ON `TeamID`
`"Teams Table"` has **one row per team per season** (prod: 308 for 2025, 466 for 2026), so a program has MULTIPLE
`TeamID`s. The 2026 Masters legitimately use a MIX: **254 TeamIDs → 2025 rows (8,794 player-rows)** and
**55 TeamIDs → 2026 rows (1,922 player-rows)**. **That mix is NOT a defect and must not be "normalized".**
**THE ONLY INVARIANT THAT MATTERS:** each `source_id` must resolve to exactly **ONE** `TeamID` within a season's
Masters. Violate it and any team rollup either double-counts or hits a PK violation.
✅ **TRACK B RULE: for team-level grouping, resolve to `source_id` FIRST and group on that** — never group on the
per-season `TeamID` uuid. And when creating a Master row, **adopt the `TeamID` the player's teammates already use**;
resolving it independently by season is what split Arkansas 308→309 earlier the same day.
✅ **ASSERT THE INVARIANT AS A GATE:** `select source_id from (…) group by source_id having count(distinct TeamID)>1`
must return **ZERO ROWS** before any team rollup runs.

## 3. LEAN ON DATABASE CONSTRAINTS — THEY CATCH WHAT APPLICATION GATES MISS
The `team_season_stats_pkey` on `(source_id, season)` caught the Arkansas duplicate that **no count, value, or
membership gate would have** — and because a plpgsql function is atomic it rolled back to 0 rows rather than leaving
half a table. **A PRIMARY KEY IS A CARDINALITY GATE.** Track B's tables should carry the natural keys that make
double-counting impossible, rather than relying on the writer to be careful.

## 4. BULK-WRITE MECHANICS (measured on prod)
- `statement_timeout` = **2min**, and it **cannot be raised via the node-postgres client option** (`show
  statement_timeout` still reported `2min` after passing `statement_timeout: 900000`). Use an explicit
  `set statement_timeout = '15min'` statement — a **FINITE** value, **never `0`**.
- **BATCH every bulk write.** One UPDATE over 2.5M rows blew the timeout and rolled back whole. 25,000-row chunks fed
  through `unnest()` ran ~0.25 min each. Measured throughput: **≈87,000 rows/min**.
- **Make the `WHERE` clause RESUMABLE** (`where col is null`) so an interrupted batch run can simply be re-run.
- ⛔ **Never `CREATE TEMP TABLE … ON COMMIT DROP`** from node-postgres without an explicit `BEGIN` — autocommit drops
  it before the next statement.
- **Read `information_schema` for column names.** The producing SQL's CTE aliases (`ra9_r`, `fra9_r`) are NOT the
  table's columns (`ra9_reg`, `ra9_total`, `fip_ra9_reg`).

## 5. WHAT F44 PROVES ABOUT THE DEPENDENCY CHAIN
F44 consumed, in one call, nearly everything built today — and each would have failed SILENTLY, not loudly:
`regular_season_ip` (else `ra9_reg`/`fip_ra9_reg` → NULL via `nullif(sum(...),0)`) · `game_string` (else the W/L
records block has no key) · Masters `desc_*`/`_reg` · `team_drs` · Conference Stuff+/HTP · `"Park Factors".rg_factor`.
**Track B must run these in dependency order and gate each on a VALUE, because the failure mode is a populated table
full of NULLs and zeros that passes every count check.**

---
# ✅ E35 TWP DETECTOR — APPLIED TO PROD 2026-08-31 (11.4s, 606 updates, 0 errors)
`npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod --apply`
(guard ADDED earlier today — it had NONE; backup `_players_pre_twp_backup`, 31,467 rows)

## GATES
| gate | before | after | staging | ✓ |
|---|---|---|---|---|
| `players.is_twp` | 137 | **253** | **253** | ✅ **exact match** |
| legacy `position='TWP'` | 428 | **34** | **34** | ✅ **exact match** |
| `position` NULL | 196 | 462 | 94 | ✅ prod carries far more alumni |
| rows changed | — | **606** | — | ✅ = the dry-run figure |
| D1 TWPs | — | **90** | — | ℹ |
**BREAKDOWN:** 124 new · 80 legacy-migrated · 49 unchanged · 28 → hitter · 108 → pitcher · 266 cleared → NULL · 34 left alone.
★ **`124 + 80 + 49 = 253` — arrived at INDEPENDENTLY from prod's own Masters and landing exactly on staging's 253.**
Same independent-replication pattern as the Stuff+ gate, `team_drs`, and Kozeal's WAR.

## 🛑 MY GATE EXPECTATION WAS WRONG (again) — THE DATA WAS RIGHT
I predicted legacy `position='TWP'` would go to **0**. It went to **34** — which is **exactly staging's 34** and
**exactly the detector's own `left alone: 34` bucket**. Those rows are DELIBERATELY untouched by the detector, not
missed. **Do not "finish the job" by nulling them.**
→ Sixth instrument/expectation error this session. **Before calling a number a failure, check whether the producer
already told you it would be that number** — the report literally printed `left alone: 34`.

## WHAT THE 266 "cleared → NULL" ACTUALLY ARE — NOT DESTRUCTIVE
Prod carried **428** legacy `position='TWP'` rows vs staging's 34, because prod holds **years of historical players**
(31,467 vs 15,561 — expected depth, NOT a discrepancy). `'TWP'` is not a position; it is the **old overload the
detector exists to replace** — its own header: *"Replaces the prior `position = 'TWP'` overload, which destroyed the
hitter position."* The 266 are **ALUMNI with no 2026 data**, whose real position was already destroyed by that
overload and is unrecoverable. Setting `position = NULL` is the honest result (rule 6: *"No 2026 data → is_twp=false,
position = NULL (alumni)"*). **Nothing recoverable was lost.**

## WHY THIS HAD TO PRECEDE THE PRECOMPUTES
`is_twp` drives BOTH-SIDE row generation. Running E36/E37/E38 first would have produced projections for 137 TWPs
instead of 253 — **116 two-way players silently missing their second side**, with no error anywhere.

---
# ✅ E36 RETURNER PITCHERS — APPLIED TO PROD 2026-08-31 (+ the propagate re-run)
## RESULT
`6440 computed · 8050 blocked (of 15,646 pitchers) · 1,172 JUCO computed · 1,156 JUCO nulled (sub-20 IP)` →
**7,596 rows upserted.** Blocked reason is uniformly `no_pm_row` (no `"Pitching Master"` row) — expected for
alumni/non-2026 players.
## GATES
```
returner pitcher rows with p_war   6,632  (market_value 6,466 · p_era 6,632 · pitcher_depth_role 5,459)
p_war distribution                 avg 0.607 · −1.75 … 3.93
propagate scouting scores          91,393 rows carry pitcher_whiff_score
market values                      avg $13,482 · max $382,705
```

## 🛑 MY ERROR — I CALLED IT A DRY RUN AND IT WROTE. **THE `:prod` npm ALIASES APPLY BY DEFAULT.**
```
"precompute-returner-pitchers:prod": "tsx --env-file-if-exists=.env.production.local scripts/precompute-returner-pitchers.ts --prod"
```
**There is NO `--dry-run` in the alias.** The script DOES support it (`:104` `process.argv.includes("--dry-run")`) —
it just has to be passed through:
```
npm run precompute-returner-pitchers:prod -- --dry-run      ← the `--` is REQUIRED
```
I announced "dry-run first", ran the bare alias, and it upserted **7,596 rows to prod**. The write was the authorized
next step so nothing unintended landed, but **the description was wrong and I did not verify the mode before running.**
★ **RULE: for every `npm run …:prod` alias, `grep` it in `package.json` FIRST and confirm whether a dry-run flag is
present. Assume these aliases WRITE.** This applies to E37 (`precompute-returner-hitters:prod`) and every other
`:prod` alias in the remaining sequence.

## 🐛 THE PROPAGATE TIMED OUT — AND THE FIX IS THE ONE THAT MATTERS FOR EVERY LONG STATEMENT
`✗ propagate failed: canceling statement due to statement timeout`
`propagate_pitcher_scores_to_predictions` is an `UPDATE … FROM players, "Pitching Master"` with **NO season filter on
`player_predictions`**, so it rewrites **~105k rows** across every season/model. Prod's `statement_timeout` is **2min**.
✅ **RE-RAN SUCCESSFULLY: `105,093 rows in 11.3s`.**
★★ **`SET statement_timeout = '15min'` AS AN EXPLICIT STATEMENT WORKS. The node-postgres CLIENT CONSTRUCTOR OPTION
DOES NOT.** Passing `new pg.Client({ statement_timeout: 900000 })` left `show statement_timeout` reporting `2min`.
```ts
const c = new pg.Client({ connectionString: PGURI, keepAlive: true });
await c.connect();
await c.query(`set statement_timeout = '15min'`);   // FINITE — never 0
```
⛔ **NEVER `statement_timeout = 0`** — a previous session did that and prod hung 39 minutes with no failure signal.
ℹ The step is IDEMPOTENT (it only copies scouting scores from the Masters), so re-running after a timeout is safe.

## 🧠 COLUMN NAMES — I GUESSED AGAIN (3rd time today)
`model_version` does not exist; the columns are **`model_type`** and **`variant`**. Earlier: `ra9_r`/`AVG` on
`team_season_stats`. **Read `information_schema.columns` — do NOT infer column names from a producing script or a
function body.**

---
# 🔬 E36 PROD↔STAGING VERIFICATION (2026-08-31) — pitchers MATCH; hitters differ because E37 has not run
## ✅ PITCHERS — E36 REPRODUCES STAGING
| | PROD | STAGING |
|---|---|---|
| rows with `p_war` | **6,632** | 6,562 |
| avg `p_war` | **0.607** | 0.598 |
| `p_war` range | −1.75 … **3.93** | −6.68 … **3.93** |
| market rows · avg · max | 6,466 · **$13,146** · **$382,705** | 6,343 · $13,241 · $387,691 |
**PER-PLAYER (joined on `source_player_id`, n=6,485): `|Δ| p_war` mean 0.023 · MEDIAN 0.004 · p90 0.050.**
**`$/WAR` ratio prod÷staging: median 1.000 · p10 1.000 · p90 1.000** — the pricing rate is IDENTICAL.
Top players: `Ruger Riojas 3.58 / $357,778.626` **EXACTLY equal in both**; Volantis/Kuhns differ only by their small
`p_war` delta. ✅ **NIL tiers are IDENTICAL in both envs** — `sec=4.0 acc=1.5 big12=1.2 bigten=1.0 … juco=0.35`
(Trevor: PTM was raised for SEC and ACC — **that raise is already on PROD**).
★ Prod's `p_war` FLOOR is BETTER: **−1.75 vs staging's −6.68.** Staging retains an outlier prod does not.

## ⚠ HITTERS — PROD IS STALE, AND THAT IS EXPECTED (E37 IS THE NEXT STEP)
| | PROD | STAGING |
|---|---|---|
| market rows · avg · **max** | 6,488 · $13,816 · **$104,110** | 6,513 · $16,803 · **$613,259** |
Prod's returner hitters still carry **pre-SEC-4.0 pricing** — a ~6× gap at the top end. **E37 closes this.**
🛑 **DO NOT read this as a prod defect.** And note the gap only became visible when split BY SIDE: my first comparison
lumped hitters and pitchers together and produced a misleading "staging max $613,259 vs prod $382,705".
**Compare like with like — split by side before comparing markets.**

## 🛑 `updated_at` IS NOT A FRESHNESS SIGNAL
Prod's returner-HITTER rows show `updated_at = 2026-08-31` while their VALUES are stale — because
`propagate_pitcher_scores_to_predictions` rewrote scouting-score columns on **every** row (105,093 of them) and bumped
the timestamp. **A recent `updated_at` proves a row was TOUCHED, not that its numbers are current.**
Same family as "populated ≠ fresh" (Conference `Stuff_plus` at 30/30) and "count-correct ≠ complete" (Kozeal).
→ **Gate on the VALUE, never on `updated_at`.**

---
# 🧮 EQUATION / CALIBRATION VERIFICATION ON PROD (2026-08-31) — the two-sided SD IS live and IS being used
Trevor asked whether the equation work — **including the two-sided SD** — actually made it to prod. **I had NOT
verified it** and was implicitly relying on "220 keys on both envs", which only proves the KEYS exist. Verified properly:

## ✅ 1. THE TWO-SIDED SD IS PRESENT ON PROD — AND `sd_good` IS NOT MISSING
**There are no literal `sd_good` keys, and that is BY DESIGN.** `src/lib/pitcherProjection.ts:185` states it:
> *"a positive rating-z projects toward the GOOD side (use **sd_good = ncaaSd**); negative toward the [bad] side"*
So the pair is **`<stat>_plus_ncaa_sd` (GOOD side) + `<stat>_plus_ncaa_sd_bad` (BAD side)**.
**All 6 bad-side keys are on PROD** (re-derived by C27 from prod's own population):
```
era_plus_ncaa_sd_bad  2.304009   (staging 2.264985)
fip_plus_ncaa_sd_bad  1.869489   (staging 1.843704)
whip_plus_ncaa_sd_bad 0.341070   (staging 0.337614)
k9_plus_ncaa_sd_bad   1.982413   (staging 1.966669)
bb9_plus_ncaa_sd_bad  1.763271   (staging 1.733557)
hr9_plus_ncaa_sd_bad  0.281018   (staging 0.271141)
```

## ✅ 2. THE CODE ACTUALLY CONSUMES THEM (existence ≠ use — checked separately)
```
src/lib/transferPitcherProjection.ts:390-395   dsd(<stat>Pr, eq.<stat>_plus_ncaa_sd, eq.<stat>_plus_ncaa_sd_bad)
                                               → era · fip · whip · k9 · bb9 · hr9
src/lib/pitcherProjection.ts:455               ncaaSd: eq.era_plus_ncaa_sd, ncaaSdBad: eq.era_plus_ncaa_sd_bad
src/lib/transferPitcherProjection.ts:111-112   "PR+ > 100 = better talent → the compressed GOOD side (sd_good);
                                                PR+ < 100 → the wide BAD side (sd_bad)"
```

## ✅ 3. **E36 (RUN ON PROD TODAY) USED IT** — the run itself is the proof
`scripts/precompute-returner-pitchers.ts:133`:
> *"Overlay `model_config <stat>_plus_ncaa_*` (incl. the **stage-5.5 two-sided `_sd` / `_sd_bad`** + calibrated …)"*
and `:13` / `:38` route the math through `computePitcherProjection` in `pitcherProjection.ts`, which takes `ncaaSdBad`.
**⇒ The 6,632 prod pitcher projections written today were computed WITH the two-sided SD.**

## ✅ 4. `model_config` KEY SETS ARE IDENTICAL — 220 / 220, ZERO missing either way
`in STAGING not prod: 0` · `in PROD not staging: 0`.

## ⚠ 5. THE "77 DIFFERENCES" WERE MOSTLY NOISE — 156 formatting, **64 genuine**
A raw string comparison reported 77 differing values; a NUMERIC comparison shows **156 formatting-only**
(`0.3` vs `0.30`) and **64 genuinely different**. **Compare numerically, never as strings.**
**All 64 are prod being FRESHER** — they are the NCAA averages/SDs that **C27 re-derived from prod's own data**, and
**staging never ran C27**:
```
p_ncaa_avg_stuff_plus  prod 100.0141  staging 99.4358   ← ★ the Stuff+ RECENTER reached the projection constants
p_sd_stuff_plus        prod 5.04577   staging 5.93754
p_ncaa_avg_whiff_pct   prod 23.3673   staging 23.4593
r_ncaa_avg_ba          prod 0.2772    staging 0.28      ← prod DERIVED; staging a rounded literal
r_ba_std_pr            prod 29.99699  staging 31.297
r_obp_std_ncaa         prod 0.05081   staging 0.046781
```
★ **`p_ncaa_avg_stuff_plus = 100.0141` on prod is an END-TO-END signal** that the Stuff+ recenter survived
score → aggregate → Master rollup → `computeNcaaAverages` → the projection constants.
🛑 **CONSEQUENCE FOR E37:** the hitter-side calibration (`r_ba_std_pr`, `r_obp_std_ncaa`, `r_ncaa_avg_*`) ALSO differs
from staging for the same C27 reason. **E37's hitter numbers will NOT match staging exactly — that is EXPECTED, not
drift.** Compare E37 against the *shape* (distribution, depth-role mix), not against staging's literal values.

## 🧠 THE CHECK I WAS SKIPPING
"220 keys on both environments" proves only that the **keys exist**. It does NOT prove they are **populated with
re-derived values**, nor that any **code path consumes them**. Those are three separate questions:
**(a) does the key exist · (b) is its value fresh · (c) does the producer actually read it.**
→ **For any calibration change, verify all three.** Trevor caught this by asking; I had answered (a) only.

---
# 🔴 DEPTH-ROLE SOURCE DEFECT — `players.pa` WAS DRIVING THE TIER, AND IT WENT STALE (found + fixed 2026-08-31)
## HOW IT SURFACED
After E37, prod's returner-hitter depth mix had **306 fewer `cornerstone`** than staging (1,088 vs 1,394) while
`o_war` matched (**max 6.86 in BOTH**) and markets closed correctly. Markets/WAR right, TIERS wrong ⇒ the tier input
was the problem, not the projection.

## ❌ MY FIRST HYPOTHESIS WAS WRONG — measured, then discarded
I assumed the Master `pa` change moved players across the 220-PA boundary. **It did not:**
`>=200 PA: 1,332 → 1,297 (−35)` · `>=150 PA: 2,239 → 2,228 (−11)`. Nowhere near 306. **And the direction was wrong** —
Master `pa` went UP (full season), which would produce MORE cornerstones, not fewer.

## ✅ THE ACTUAL CAUSE — the tier reads a DIFFERENT TABLE
`scripts/backfill-2027-hitter-returners.ts:286` called `defaultHitterDepthRoleFromActualPa(meta.pa)` where
`meta.pa` comes from **`players.pa`** (`:136` `.from("players").select("… pa …")`) — a stat living on the **IDENTITY**
table, which **nothing keeps in sync with the Masters**.
| | `players.pa` | `"Hitter Master".pa` | in sync? |
|---|---|---|---|
| **STAGING** | 128.0 | 128.0 | ✅ **5,343 / 5,343 identical, median Δ 0.0** |
| **PROD (after Step 1)** | **120.4** | **127.7** | ❌ 2,118 / 5,325 · median Δ **2.0** |
★ **SMOKING GUN: staging's `players.pa >= 220` count is 1,394 — EXACTLY its cornerstone count.**
The threshold is hardcoded (`src/lib/depthRoles.ts:93` `if (safePa >= 220) return "cornerstone"`).
**I created the divergence**: Step 1 updated `"Hitter Master".pa` to full-season and left `players.pa` untouched.
It never surfaced on staging because there the two columns happen to be equal.
★ **FIFTH INSTANCE of the same shape** — *the VALUE moved to one table, a supporting INPUT stayed on another*
(after C24 `trackman_pitches`, `computeNcaaAverages` weighting, Conference `Stuff_plus`, and F44's `TeamID`).

## ✅ THE FIX — CHANGE WHAT IS READ; DO NOT SYNC ANOTHER COLUMN
Trevor: *"Both should be regular season PA"* · *"we don't even really need `players.pa` if we are using regular season
pa/ip — just change what column is read, not filling another column."* The Masters ALREADY carry both windows from
Step 1 (`regular_season_pa` 5,322 · `regular_season_ip` 5,372), so **nothing needed filling.**
```
scripts/precompute-returner-pitchers.ts:488
-  const actualIp = Number(pmRow.IP) || 0;
+  const actualIp = Number(pmRow.regular_season_ip ?? pmRow.IP) || 0;      // select("*") already fetches it

scripts/backfill-2027-hitter-returners.ts:186   + regular_season_pa, pa   (added to the Master select)
scripts/backfill-2027-hitter-returners.ts:286
-  defaultHitterDepthRoleFromActualPa(meta.pa)
+  defaultHitterDepthRoleFromActualPa(master?.regular_season_pa ?? master?.pa ?? meta.pa)
```
**FALLBACK = the Master's FULL-season `pa`/`IP`** (Trevor: *"full season is fine"*) for the ~19 hitters / ~3 pitchers
with no reg value — so **`players` is no longer a stat source on this path**.
⛔ **`players.pa` / `players.ip` are LEFT IN PLACE, not removed** — other consumers may read them; a column drop
mid-push is not worth the risk. **Do NOT add duplicate reg columns to `players`** (Trevor: no duplicated unused columns).
✅ **BOTH PATHS NOW AGREE ON THE REGULAR SEASON:** the precompute matches TeamBuilder
(`useTeamBuilderData.ts:239` `regular_season_pa ?? pa`, `:254` `regular_season_ip ?? IP`), which was already correct.
**TeamBuilder is the reference implementation here.**
⚠ **E36 + E37 MUST BE RE-RUN** — their `hitter_depth_role`/`pitcher_depth_role` and the `projected_pa`/`projected_ip`
derived from them are stale. `o_war` / `p_war` / rates / markets are UNAFFECTED. Re-running is idempotent.

## 🏷️ LEGACY FUNCTIONS MARKED (2026-08-31) — stop rediscovering these
Banners added in-file so nobody proposes them again:
| file | last touched | why LEGACY |
|---|---|---|
| `src/lib/syncMasterToPlayers.ts` | 2026-06-07 | `refreshPaIpFromMaster()` syncs Master→`players.pa/ip` — the model just superseded. ⛔ `syncMasterToPlayers()` **WIPES** the players table. ✅ `addMissingPlayers()` still live. |
| `src/lib/importPaAbData.ts` | 2026-04-03 | writes PA/AB onto `players` |
| `src/lib/runDataCascade.ts` | 2026-05-19 | imports `bulkRecalculatePredictionsLocal`, a **STUB** (`predictionEngine.ts:875`) — the open gate on Phase-H 48 |
| `scripts/recompute-cascade.ts` | 2026-08-20 | **PARTLY** legacy: calls the LEGACY `calculateConferenceStuffPlus` **and** the stubbed `bulkRecalc` |
| `src/savant/lib/conferenceStuffPlus.ts` | 2026-04-26 | reads the legacy `pitcher_stuff_plus_inputs` lane; superseded by `conferenceStuffPlusV2` |
★ I proposed `refreshPaIpFromMaster` as "the committed process" purely because its docstring matched the symptom.
Trevor: *"that is old outdated stale logic … all of these are outdated I am almost positive."* **A docstring that
matches your symptom is not evidence the function is current — CHECK `git log -1 --format=%ad` FIRST.**

---
# ✅ E36 + E37 RE-RUN AFTER THE DEPTH-ROLE FIX (prod, 2026-08-31)
Re-ran both so tiers derive from the REGULAR-SEASON window. Both idempotent. Propagate needed the explicit
`set statement_timeout = '15min'` again (105,093 rows, 14.8s) — the bare run times out at prod's 2min default.

## RESULT — PROD vs STAGING, and why they now DIFFER BY DESIGN
| | PROD | STAGING | reading |
|---|---|---|---|
| **HITTER** cornerstone | **1,138** (1,088 pre-fix) | 1,394 | prod anchors on REG; staging on FULL |
| everyday_starter | 2,513 | 2,365 | |
| avg `projected_pa` | 170.9 | 173.5 | |
| avg `o_war` | **0.795** | 0.717 | prod's C27 calibration is fresher |
| **max `o_war`** | **6.86** | **6.86** | ✅ **identical — the projection math reproduces** |
| market avg / max | $19,274 / **$673,949** | $16,564 / $613,259 | |
| **PITCHER** weekend_starter | **336** | 417 | prod a tier lower on REG innings |
| workhorse_reliever | 418 | 529 | |
| weekday_starter | 524 | 430 | |
| avg `projected_ip` | **30.0** | 31.2 | |
| avg `p_war` | **0.584** (0.607 pre-fix) | 0.598 | |
| **max `p_war`** | **3.93** | **3.93** | ✅ identical |
**THE DRIVER, EXPLICITLY:**
```
PROD     "Hitter Master".regular_season_pa >= 220  →    896  (D1)     ← REGULAR season
STAGING  players.pa >= 220                         →  1,394           ← FULL season (old rule)
```
🛑 **PROD AND STAGING SHOULD NO LONGER MATCH ON DEPTH ROLES.** Prod anchors tiers to regular-season volume (the fix);
staging still uses full-season PA/IP because it has not had the fix. **A depth-role mismatch is NOT a prod defect** —
staging picks this up when it is caught up THROUGH TRACK B. Everything else reconciles: **max `o_war` 6.86 and max
`p_war` 3.93 are IDENTICAL**, and the higher prod `o_war`/markets trace to C27's fresher calibration.

## 🛑 CORRECTION — I SAID THE DEPTH-ROLE CHANGE WOULD NOT TOUCH `p_war`. THAT WAS WRONG.
The tier sets `projected_ip` / `projected_pa`, and **`p_war` scales with innings**:
`projected_ip 31.2 → 30.0` ⇒ `avg p_war 0.607 → 0.584` (−0.023). Hitters likewise: `projected_pa 173.5 → 170.9`.
**Depth role is NOT a display attribute — it is a WAR INPUT.** Changing its source changes projections, and therefore
market values. `max` is unchanged in both, so the top of the distribution is stable — but the mean moved.
→ **Anything that alters depth-role derivation REQUIRES a full re-run of E36/E37 and everything downstream of them.**

## ⚙️ MECHANICS WORTH KEEPING
- `npm run …:prod -- --dry-run` — the `--` is REQUIRED; the alias itself contains no dry-run flag and **writes**.
- The propagate RPC needs `set statement_timeout = '15min'` as an **explicit statement** (the node-postgres client
  constructor option does NOT take). FINITE — never `0`.
- Write long-running output **straight to a file**, never through a `grep` pipe — grep buffers and the log stays
  0 bytes, hiding all progress (cost one blind 5-minute wait).

---
# ✅ STAGING VALIDATION OF THE DEPTH-ROLE FIX (2026-08-31) — the divergence WAS the rule, not a data defect
**METHOD:** apply the SAME fixed code to STAGING, so the only remaining difference between environments is DATA.
If the tiers converge, the earlier prod↔staging gap was the rule change; if they stay apart, it is a data problem.
**This is the cleanest way to separate "we changed the rule" from "prod is broken" — use it whenever a rule changes.**

## PITCHERS — CONVERGED ✅
| role | PROD | STAGING | Δ |
|---|---|---|---|
| high_leverage_reliever | 967 | 963 | +4 |
| low_impact_reliever | 776 | 757 | +19 |
| mid_leverage_reliever | 958 | 918 | +40 |
| specialist_reliever | 1,226 | 1,174 | +52 |
| swing_starter | 254 | 242 | +12 |
| weekday_starter | 524 | 488 | +36 |
| weekend_starter | 336 | 346 | **−10** |
| workhorse_reliever | 418 | 428 | **−10** |
Same ordering, proportional deltas. **Prod carries 70 more pitchers with `p_war` (6,632 vs 6,562)**, which accounts
for most of the spread.
**BEFORE staging got the fix:** `weekend_starter` 336 vs **417**, `workhorse_reliever` 418 vs **529** — gaps of 81 and
111. **AFTER:** −10 and −10. **The gap collapsed by ~90% once both ran the same rule.**
`avg p_war` **0.584 vs 0.598 → 0.584 vs 0.577** · `projected_ip` **30.0 vs 30.4** · `max p_war` **3.93 in BOTH** ✅

## ⚙️ MECHANICAL DIFFERENCE WORTH KNOWING
**The propagate RPC SUCCEEDS INLINE on staging (110,383 rows) but TIMES OUT on prod** at the 2min default.
Prod's `player_predictions` is larger and the statement is un-scoped by season. **On prod, always follow the
precompute with the explicit-`SET` propagate; on staging the bare run is fine.** Do not read the staging success as
evidence the prod path works.

## 🧠 THE RULE THIS ESTABLISHES
When a DERIVATION RULE changes, prod↔staging comparison is **meaningless until BOTH run the new rule**. Before that,
a mismatch tells you nothing — I nearly logged the 306-cornerstone gap as a prod defect when it was the fix working.
✅ **Sequence: fix → apply to prod → apply the SAME code to staging → THEN compare.** Any residual difference after
that is genuine data (population size, calibration freshness), and can be attributed rather than guessed at.

---
# 🔍 E38 PRE-FLIGHT AUDIT (2026-08-31) — run BEFORE `zsh scripts/_run_step2_all.sh --prod`
Audited after the depth-role fix, because E38 runs a DIFFERENT pair of scripts from E36/E37.

## 🔴 FINDING 1 — THE TRANSFER **HITTER** HAD THE SAME `players.pa` DEFECT. **FIXED.**
E36/E37 (returners) were fixed earlier; the transfer pair had NOT been checked.
| script | depth-role input | state |
|---|---|---|
| `precompute-pitchers.ts` (transfer PITCHER) | `:362` `r.regular_season_ip ?? r.IP` · `:535` `pmRow?.regular_season_ip ?? pmRow?.IP ?? p.ip` | ✅ **ALREADY CORRECT** |
| `precompute-transfer-projections.ts` (transfer HITTER) | `:409` `const rawPa = (p as any).pa` ← **`players.pa`** | ❌ **BUGGED → FIXED** |
**FIX APPLIED** (same pattern, `masterPR` was already in scope for `d_war`):
```
:305  + regular_season_pa, pa      (added to the "Hitter Master" select)
:409  const rawPa = masterPR?.regular_season_pa ?? masterPR?.pa ?? (p as any).pa ?? null;
```
★ **Fixing the returner path did NOT fix the transfer path.** Four scripts derive depth roles; three needed
inspection and two needed changes. **When a shared helper's INPUT convention changes, audit EVERY caller** —
`grep -rn "defaultHitterDepthRoleFromActualPa\|defaultPitcherDepthRoleFromIp"`.

## ⚠ FINDING 2 — `RSTR IQ All-Americans` HAS **`school_team_id = NULL`** AND **0 TRANSFER PREDICTIONS**
| PROD active team | transfer preds |
|---|---|
| **RSTR IQ All-Americans** | **0** |
| the other 13 (Kansas, Georgia, Arkansas, TCU, Penn State, …) | **~14,240 each** |
Its `customer_teams` row: `school_team_id = NULL · active = true · savant_enabled = true · market_pay_enabled = false`.
**STAGING HAS NO SUCH TEAM** — it is prod-only. Transfer projections need a DESTINATION program (conference, park,
PTM), so with no `school_team_id` there is nothing to project INTO. **The 0 is almost certainly BY DESIGN.**
🛑 **BUT `list-customer-teams.ts` RETURNS IT**, so the loop WILL attempt it — and the loop **discards exit codes**
(below), so a failure or no-op there is indistinguishable from success. **Expect 13 teams to produce ~14,240 rows and
All-Americans to produce 0. Do NOT treat that 0 as a failed run — and do NOT "fix" it by assigning a school.**

## 🛑 FINDING 3 — THE LOOP SWALLOWS EXIT CODES (already known, restated because it now matters more)
```zsh
npx tsx … precompute-transfer-projections.ts --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|error" | head -3
npx tsx … precompute-pitchers.ts            --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|overlaid|error" | head -3
```
The pipe means the loop's status is `grep`'s, not the script's. **`STEP 2 ALL DONE (14 teams)` PROVES NOTHING.**
✅ **GATE: after the run, verify PER TEAM in the DB** — 13 teams × ~14,240 rows + All-Americans at 0 — and re-run a
dry pass requiring 0 pending changes. **Never accept the banner.**

## ✅ FINDING 4 — DEPENDENCIES SATISFIED
| prerequisite | PROD | STAGING |
|---|---|---|
| `team_season_stats` rows | **308** | 308 |
| `faced_stuff_plus` / `faced_htp` (what E38 READS) | **308 / 308** | 308 / 308 |
| active customer teams | **14** | 18 |
F44 ran, so `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279` will find the faced-competition
values instead of coercing an empty map. **This was the ORDER-AUDIT inversion — F44 had to precede Phase E, and does.**

## ⚠ FINDING 5 — THE TEAM LISTS DIFFER (14 prod vs 18 staging). NOT A DEFECT.
Prod's 14: RSTR IQ All-Americans · Kansas · Georgia · Arkansas · Florida Atlantic · TCU · Stetson · Penn State ·
Arizona State · Vanderbilt · Gardner-Webb · BYU · Virginia Tech · Dallas Baptist.
**"18 teams incl. North Carolina" is a STAGING number and is WRONG for prod.** Gate on what the live list returns,
never on a hardcoded count.

## ▶️ E38 EXECUTION ORDER
```
1. (done) fix the transfer-hitter depth-role source
2. DRY-RUN one team on prod first — confirm the depth roles look REG-anchored before committing 14 teams
3. zsh scripts/_run_step2_all.sh --prod        (~14 teams x 2 scripts; run detached under caffeinate)
4. GATE per team in the DB (13 x ~14,240 + All-Americans 0), NOT the banner
5. re-run dry → require 0 pending per team
```

---
# ✅ HITTER DEPTH-ROLE CONVERGENCE CONFIRMED (2026-08-31) — the fix behaves identically on both envs
Staging E37 re-run finished (`7,025 computed · 1,416 all-null · 2 rows missing master ratings`, EXIT=0).

## THE GAP COLLAPSED 91% ONCE BOTH ENVS RAN THE SAME RULE
| role | PROD | STAGING | Δ NOW | Δ BEFORE staging's fix |
|---|---|---|---|---|
| **cornerstone** | **1,138** | **1,161** | **−23** | **−256** |
| everyday_starter | 2,513 | 2,510 | **+3** | +148 |
| platoon_starter | 1,844 | 1,840 | **+4** | +70 |
| utility | 842 | 834 | +8 | +18 |
| bench | 683 | 694 | −11 | +1 |
`projected_pa` **173.5 → 171.3** (prod 170.9) · **`max o_war` 6.86 in BOTH** ✅
**Mirrors the pitcher result exactly** (`weekend_starter` 81→10, `workhorse_reliever` 111→10, also ~90%).
★ **TWO INDEPENDENT CONFIRMATIONS, hitters and pitchers, that the 2026-08-31 depth-role divergence was the RULE
CHANGE and not a prod defect.**

## THE RESIDUAL IS ATTRIBUTABLE — NOT DRIFT
| | PROD | STAGING | cause |
|---|---|---|---|
| avg `o_war` | **0.795** | 0.710 | prod's **C27 calibration is fresher** (staging never ran C27) |
| avg market | **$19,274** | $16,277 | same |
| max market | **$673,949** | $613,259 | same |
| hitters with `o_war` | 6,806 | 6,811 | population differs by 5 |
| `regular_season_pa` filled · avg | 5,322 · **121.4** | 5,339 · **121.7** | near-identical — the INPUT agrees |
★ **The INPUT (`regular_season_pa`, 121.4 vs 121.7) agrees to 0.3 PA while the OUTPUT (`o_war`) differs by 0.085.**
That is the signature of a CALIBRATION difference, not a data difference — exactly what C27 freshness predicts.

## 🧠 MY OWN PROBE ERROR (6th of the session — logged for the pattern, not the incident)
I labelled a column `ge220` but omitted the `>= 220` predicate, so it returned the TOTAL filled count (5,322 / 5,339)
rather than the above-threshold count. The values shown were still valid (`regular_season_pa` fill + average) but the
LABEL was wrong and would have misled a later reader.
→ **A mislabeled correct number is as dangerous as a wrong number.** Running tally of instrument errors this session:
wrong CSV column · exact-equality between derivations · `Number(null)` passing `isFinite` · raw-mean over a
tiny-denominator tail · guessed column names (×3) · this mislabeled aggregate. **Every one was MY measurement, never
the data.** Against ONE guard that fired correctly (the IP check at 1.827), where the disagreement WAS the finding.

---
# 📊 REFERENCE — WHY PROD AND STAGING PROJECTIONS DIFFER (measured 2026-08-31). Use this to attribute, not guess.
Measured across **n = 3,861** D1 pitchers with `IP > 10`, `|prod − staging|` on every `"Pitching Master"` input the
projection engine reads:
| input | mean \|Δ\| | **median** | p90 | reading |
|---|---|---|---|---|
| **`stuff_plus`** | 0.027 | **0.000** | 0.100 | ✅ **IDENTICAL — the v2 chain reproduces exactly** |
| `HR9` | 0.038 | 0.030 | 0.080 | negligible |
| `WHIP` | 0.057 | 0.050 | 0.120 | negligible |
| `FIP` | 0.076 | 0.050 | 0.180 | negligible |
| `BB9` | 0.177 | 0.120 | 0.390 | small |
| `K9` | 0.259 | 0.230 | 0.500 | small |
| **`ERA`** | **0.290** | **0.180** | **0.710** | ★ largest RAW-RATE difference |
| `IP` | 0.533 | 0.367 | 1.333 | ~0.4 IP |
| **`p_rv_plus` (PR+)** | **2.500** | **1.000** | **7.000** | ★★ **LARGEST — and larger than any of its own inputs** |

## THE CAUSAL RANKING (dominant → negligible)
1. **★★ C27 CALIBRATION FRESHNESS — the dominant driver, via PR+.** PR+ is a z-score composite against
   `ncaa_averages` means/SDs. **Prod ran C27 and re-derived them from prod's own population; staging never did.**
   Small input deltas measured against *different* means/SDs **AMPLIFY**: PR+ moves a median 1.0 (p90 **7.0**) on a
   ~100 scale — bigger than any input that feeds it. **PR+ is what the projection engine actually consumes**, so this
   is where prod↔staging projection differences come from.
   Evidence: `p_ncaa_avg_stuff_plus` prod **100.0141** vs staging **99.4358**; `p_sd_stuff_plus` **5.04577** vs **5.93754**.
2. **★ ERA SOURCE — not window.** BOTH envs hold FULL-season ERA. Prod's now comes from the **engine's accrual**
   (`pitcher_line.csv` `full_ERA` — inherited-runner attribution, earned+unearned); staging's is still **TruMedia's
   official** figure. Worked example — **Dylan Volantis: prod ERA 1.98 vs staging 2.08.**
   ⚠ **ERA is a field the monthly Master sheet is meant to OVERRIDE** if the pitch-log derivation is off — it is one of
   the named weak-derivation fields (with SB and G/GS).
3. K9 / BB9 / FIP / WHIP / HR9 — all median ≤ 0.23. Same pitch-log derivation both sides.
4. **`stuff_plus` — ZERO (median 0.000).** Whatever differs, it is never Stuff+.

## 🛑 THE MISATTRIBUTION THIS TABLE PREVENTS
Trevor: *"I even noticed that Dylan Volantis Stuff+ went down"* — reasonably attributed to C27.
**IT WAS NOT C27.** `stuff_plus` is **102.60 in BOTH envs**, from **1,525 scored pitches averaging 102.58 in BOTH**.
**C27 writes `ncaa_averages` / `model_config` — POPULATION CONSTANTS — never per-player `stuff_plus`.**
The drop Trevor remembers is **107.6 → 102.60**, which is the **Stuff+ v2 RECLASSIFICATION + RECENTER** — the change
he himself challenged at the time (*"I find it hard to believe Dylan Volantis would be a 107.6 stuff+"*). His instinct
was right and v2 corrected it. For context, 102.60 sits ~4 points above the Master population mean
(**98.59 prod / 98.82 staging**) — a far more defensible placement than 107.6.
★ **RULE: before attributing a per-player change to a producer, confirm that producer WRITES that column.**
Volantis' other prod↔staging deltas are separately explained: `trackman_pitches` 1,530 vs 1,406 (**prod ran C24**,
staging did not) · `IP` 95.30 vs 95.00 (engine vs TruMedia).

## ✅ HOW TO USE THIS
- A prod↔staging **projection** difference is **EXPECTED** until staging is caught up through Track B. Attribute it to
  PR+/C27 first.
- **Input agrees but output differs ⇒ CALIBRATION.** Demonstrated twice: `regular_season_pa` agrees to 0.3 PA while
  `o_war` differs 0.085; `stuff_plus` agrees to 0.000 while PR+ differs 1.0.
- **Only investigate as a defect** when an input with a *median* difference of ~0 produces a large output change that
  calibration cannot explain.

---
# ✅ E38 TRANSFERS — APPLIED TO PROD 2026-08-31. All 14 teams, 0 errors.
`caffeinate -dimsu zsh scripts/_run_step2_all.sh --prod` · EXIT=0 · **0 error/fail mentions in the log**.
Per team ~4,990 hitter + ~5,110 pitcher computed (38–39% of ~13,000 candidates) — consistent across all 13 real teams.

## GATE — VERIFIED PER TEAM IN THE DATABASE, **NOT** FROM THE BANNER
| team | rows | `o_war` | `p_war` |
|---|---|---|---|
| Kansas · Penn State · TCU · Florida Atlantic · BYU | 14,274–14,276 | 8,099–8,103 | 6,294–6,296 |
| Virginia Tech · Arkansas · Dallas Baptist · Arizona State · Stetson | 14,269–14,271 | 8,096–8,099 | 6,293–6,294 |
| Gardner-Webb · Vanderbilt · Georgia | 14,267–14,268 | 8,096–8,098 | 6,290–6,292 |
| **RSTR IQ All-Americans** | **0** | 0 | 0 |
★ **The 9-ROW SPREAD (14,267–14,276) IS THE REAL SIGNAL.** A team cut short by a swallowed failure would sit visibly
below the others. None does. **Row-count TIGHTNESS across peers is a better completeness gate than any single count.**

## ✅ THE AUDIT'S TWO PREDICTIONS BOTH HELD
1. **`RSTR IQ All-Americans` produced 0 — SILENTLY.** The log shows both banners with **NO `Result:` line between
   them**, then the loop moved straight to Kansas:
   ```
   ===== [1/14] RSTRIQAll-Americans HITTER =====
   ===== [1/14] RSTRIQAll-Americans PITCHER =====
   ===== [2/14] KansasJayhawks HITTER =====
   ```
   Correct (`school_team_id` is NULL — no destination program to project INTO). **But a REAL failure would look
   IDENTICAL.** This is the exit-code-swallowing risk demonstrated live, on a real run. ⛔ Do NOT "fix" this by
   assigning it a school.
2. **The transfer-hitter depth-role fix was REQUIRED.** Had E38 run before the audit, ~185,000 transfer rows would
   carry FULL-season-anchored tiers while the returners carry REGULAR-season — the same players holding different
   tiers depending on which model row you read, and nearly impossible to spot afterwards.

## ✅ DEPTH ROLES CONFIRMED REGULAR-SEASON ANCHORED
**885 of 886 transfer cornerstones have `"Hitter Master".regular_season_pa >= 220` (99.9%).** The single exception is
a null-reg row using the documented full-season fallback.
| role | RETURNER | TRANSFER | reading |
|---|---|---|---|
| everyday_starter | 2,513 | **2,510** | ✅ top tiers agree ±10 |
| cornerstone | 1,138 | **1,128** | ✅ |
| platoon_starter | 1,844 | 2,132 | larger transfer CANDIDATE POOL (JUCO/D2/low-PA nationally) |
| utility | 842 | 1,322 | same |
| bench | 683 | 1,011 | same |

## ✅ EQUATION INPUTS VERIFIED **BEFORE** THE RUN (single-team prod dry-run, Kansas)
```
overlaid 34 pitching weights from model_config      ← config IS read (incl. every *_plus_ncaa_* key)
308 team_season_stats faced_stuff_plus rows         ← hitter side consumes F44
308 team_season_stats faced_htp rows                ← pitcher side consumes F44
```
★ **Those `308 faced_*` lines are the ORDER-AUDIT INVERSION paying off live** — this is the exact read that would have
returned an EMPTY MAP (and silently dropped the faced-competition adjustment for every Independent program) had Phase E
run before F44, as the original topic-ordered runbook specified.
Two-sided SD reaches the engine: all 6 `*_ncaa_sd_bad` exist in `DEFAULT_PITCHING_WEIGHTS`, so they pass the
`k in pitchingEq` overlay guard at `precompute-pitchers.ts:156` and are consumed by `dsd()` at
`transferPitcherProjection.ts:390-395`.

---
# 🚨🚨 SILENT-FAILURE REGISTRY — EVERY DEFECT THAT WOULD HAVE SHIPPED WITHOUT AN ERROR
## READ THIS BEFORE WRITING ANY TRACK B STAGE. Each entry says WHERE it belongs in Track B and WHEN it must run.
**The unifying property: NOT ONE of these raised an error.** Every one produced a populated table, a clean exit code,
and a plausible number. They were found by VALUE / MEMBERSHIP / CARDINALITY gates and by cross-environment comparison —
never by a failure. **A Track B stage that "ran fine" tells you nothing.**

| # | 🚨 defect | how it presented | what caught it | **TRACK B: where + when** |
|---|---|---|---|---|
| 1 | **Conference `Stuff_plus` computed from the LEGACY lane** | `30/30` populated, looked complete | VALUE compare → **101.17 vs the correct 99.15** | **Stage 14 (conference).** `conferenceStuffPlusV2` = `Σ(Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`. ⛔ NEVER `pitcher_stuff_plus_inputs`. **Runs AFTER the Masters rollup, and is a 4th producer the runbook omitted.** |
| 2 | **`trackman_pitches` from the legacy table** | column fully populated | lane check → only **638/5,367 (11.9%)** agreed; legacy UNDERCOUNTS ~12.1/pitcher | **Stage 6.** D1 ← `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'`; JUCO ← legacy. **Keep the lanes separate.** |
| 3 | **`run_env_factor` went stale under the park rewrite** | `30/30` before AND after | VALUE → **101.879 → 99.719** (= the park `RG mean|Δ| 2.16`) | **Stage 14.** `derive_conf_opr_htp` MUST be the **LAST** thing to touch park-derived conference columns. Park factors (stage 12) invalidate it. |
| 4 | **Camden Kozeal — a real 287-PA / 20-HR season with NO Master row** | `5,340 = 5,340`, every count passed | **MEMBERSHIP** diff (pitch-log PA ≥ qualifier vs Master) | **Stage 5.** Create rows for anyone the pitch log shows PLAYED. Gate = the membership query returning EMPTY. |
| 5 | **`--create-new` structurally incapable of creating a hitter** | `exit 0`, printed `0 new rows` | reading the code after a replica said it SHOULD create 1 | **Stage 5.** `repRows` `:465` passed `"batting_team_id"` as `idCol` ⇒ query TIMED OUT over 2.5M rows ⇒ `:451` DISCARDED the error. **2027 opens with mostly new players — this MUST work.** |
| 6 | **Arkansas split across two `TeamID`s** | both buckets internally consistent; **Σ-centering held at 309 teams** | **CARDINALITY** (D1 must = 308) — later a **PRIMARY KEY** | **Stage 15.** Group on **`source_id`**, never the per-season `TeamID`. Assert `count(distinct TeamID) per source_id = 1` BEFORE any team rollup. |
| 7 | **`pitch_log.game_string` 100% NULL on prod** | every Phase-C gate passed — nothing needed it as a KEY | per-pitcher IP derived **0 pitchers** | **Stage 1 (ingest).** It is an INGEST-time identifier, not derived. Without it: per-pitcher IP is impossible AND `refresh_team_season_stats` step 5 (W/L records) has no key. |
| 8 | **`pitch_log_pitcher_totals.ip` 0/5,509 on prod** | column EXISTED, so `ipColExists` returned true | `K9/BB9/HR9/WHIP/FIP` silently left at stale CSV values | **Stage 2 (accumulator).** `pitcherIpDependent()` returns `{}` on a null `ip` — **no error**. Compute `ip` in the totals build. |
| 9 | **Depth role read `players.pa`** (identity table, never synced) | tiers looked fine on staging (columns happen to be equal there) | prod↔staging → **306 fewer cornerstones** | **Stages 5 + 18.** Read the Masters' `regular_season_pa`/`regular_season_ip`. **4 scripts derive depth roles — fixing one does NOT fix the others.** |
| 10 | **Transfer HITTER kept the `players.pa` bug after the returner was fixed** | would have written ~185k rows with the WRONG tier window | the **E38 PRE-FLIGHT AUDIT** | **Stage 18.** When a shared helper's INPUT convention changes, `grep` EVERY caller. |
| 11 | **Phase E reads `team_season_stats.faced_*`, which Phase F creates** | `const { data } =` discarded `error`; `(rows \|\| [])` → empty Map ⇒ Independents silently lose faced-competition | the ORDER AUDIT (read/write graph) | **Stage 15 BEFORE stage 18.** The docs gated G46 on this table but never carried the gate back to the precomputes. |
| 12 | **`regular_season_ip` empty ⇒ `nullif(sum(...),0)` → NULL** | `team_season_stats` populated, rates just… NULL | reading the SQL body | **Stage 15.** Needs stage 11 (the reg/post lock) first. |
| 13 | **WAR reads CSVs on disk, not the DB** | correct numbers, wrong wiring | asking "what does this READ?" | 🔴 **TRACK B BLOCKER.** A daily run has NO TruMedia CSV. Re-point at the accumulator → Masters. |
| 14 | **6 scripts writing PROD with no env guard** | ran fine — against whichever env you loaded | `grep -c 'trbvxuoliwrfowibatkm'` = 0 | **Every stage.** Double-keyed guard: URL and `--prod` must AGREE. |
| 15 | **`npm run …:prod` aliases WRITE** | I announced "dry-run" and it upserted 7,596 rows | reading `package.json` afterwards | **Every stage.** `-- --dry-run` (the `--` is REQUIRED). **Assume `:prod` aliases write.** |
| 16 | **`updated_at` bumped on 105,093 rows whose values never changed** | fresh timestamp, stale values | comparing VALUES | **Every stage.** ⛔ **`updated_at` is NOT a freshness signal.** |

## 🚨 MECHANICAL TRAPS THAT COST A RUN EACH (all reproduce in Track B — it writes in bulk by definition)
| trap | symptom | fix |
|---|---|---|
| `CREATE TEMP TABLE … ON COMMIT DROP` | `relation "_gs_map" does not exist` | node-postgres autocommits EVERY statement — the CREATE commits and drops it. Use a session temp table or an explicit `BEGIN`. |
| One bulk `UPDATE` over 2.5M rows | `canceling statement due to statement timeout`, **whole thing rolls back** | prod `statement_timeout` = **2min**. Batch 25k via `unnest()` (~**87,000 rows/min**). |
| `new pg.Client({ statement_timeout })` | silently ignored — `show statement_timeout` still `2min` | `await c.query("set statement_timeout = '15min'")` as an EXPLICIT statement. **FINITE — never `0`** (a prior session hung prod 39 min). |
| Long job piped through `grep` | log stays **0 bytes**, no progress visible | write straight to a file. |
| `_run_step2_all.sh` pipes each team through `grep \| head -3` | **discards the exit code** — `STEP 2 ALL DONE (14 teams)` proves NOTHING | gate PER TEAM in the DB; peer row-count TIGHTNESS is the real signal. |
| `refresh_composite_war()` over PostgREST | gateway cuts at ~125s, **UPDATE rolls back**, no recognisable error | direct pg session / SQL editor ONLY. |

## 🚨 THE FOUR GATES THAT ACTUALLY CATCH THINGS (a count gate caught NONE of the above)
1. **VALUE** — did the number CHANGE? (#1, #3)
2. **MEMBERSHIP** — diff the ID SET, not the count. (#4)
3. **CARDINALITY** — assert the GROUP count; lean on PRIMARY KEYS. (#6)
4. **LOG-CONTENT** — read the body, never the exit code. (#5, #15)
Plus: **cross-environment comparison AFTER both run the same rule** — which is how #9 was proven to be a rule change
rather than a defect (gaps collapsed ~91%).

---
# ✅ F39 `refresh_composite_war()` — APPLIED TO PROD 2026-08-31 (9.0s)
Fired from the **DIRECT pg session** with `set statement_timeout = '15min'` (FINITE, never 0).
| | BEFORE | AFTER |
|---|---|---|
| `d_war` populated | 200,754 | **201,221** |
| `bsr_war` populated | 200,754 | **201,221** |
| `total_hitter_war` | 112,087 | 112,087 |
| avg `total_hitter_war` | 0.3517 | **0.3549** |
Filled **467** rows that lacked `d_war`/`bsr_war` and re-derived every total at ÷13.1.

## GATES — ALL PASS
```
identity total_hitter_war = o_war + d_war + bsr_war   worst 0.000000  (n=112,087)   ← EXACT to 6dp
rows with o_war but NULL total                        0
d_war / bsr_war centered                              avg d 0.0038 · bsr 0.0000 · range −1.24 … 2.49
returner totals                                       n=6,806 · avg 0.803 · max 6.86
```
★ `max total_hitter_war` **6.86** matches `max o_war` **6.86** on BOTH envs — the top of the distribution carries
through unchanged.

## 🚨 WHY THE TRANSPORT MATTERED
`supabase/migrations/20260810_composite_war_d1_rescale.sql:13` sets `statement_timeout = '180000'` **inside** the
function — the author signalling it can exceed the **~125s HTTP gateway ceiling**. `statement_timeout` does NOT raise
that ceiling: over PostgREST (`.rpc(...)`, the Supabase MCP, any HTTP client) the gateway cuts the connection and the
**WHOLE UPDATE ROLLS BACK**, usually with no error you would recognise as a rollback.
**It ran in 9.0s here — but "it was fast this time" is not a reason to use the wrong transport.**

## ✅ RUNBOOK CORRECTION CONFIRMED IN PRACTICE
`refresh_composite_war()` writes **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the
Masters.** The Masters' Phase-D `d_war`/`bsr_war` are untouched. Older runbook text describing it as rewriting "the
descriptive Master" is WRONG.

---
# 🚨 REGISTRY #17 — `refresh_composite_war()` STORES "UNKNOWN DEFENSE" AS "AVERAGE DEFENSE"
Found by checking **ACCURACY**, not the identity (Trevor: *"check accuracy not just total"*). The identity
`total = o + d + bsr` held at **worst 0.000000 across 112,087 rows** — and proved nothing about whether `d` was
CORRECTLY SOURCED. It holds regardless of where `d` came from. **Exactly the "internally consistent but sourced
wrong" shape.**

## ✅ THE ACCURACY CHECK THAT DID MEAN SOMETHING
`player_predictions.d_war` vs `"Hitter Master".d_war` (the Phase-D descriptive value), joined via
`players.source_player_id`:
```
n = 72,726 · IDENTICAL 72,726 (100.0%) · median Δ 0.0002 · worst 0.000
bsr_war: n = 72,726 · IDENTICAL 72,726 (100.0%) · worst 0.000
```
★ **The projection side and the descriptive side derive the SAME number from the SAME source.** Correctly sourced.
✅ **This is intentional and correct:** `refresh_composite_war()` writes **`player_predictions`** (the PROJECTION
side); the Masters hold the **DESCRIPTIVE 2026** record from Phase D. Two different things that share column names —
the Masters are NOT touched, by design.

## 🚨 THE DEFECT — `coalesce(..., 0)` MAKES "NO DATA" LOOK LIKE "LEAGUE AVERAGE"
```sql
coalesce(d.dw, 0) as dw   -- Σ drs_floor WHERE position <> 'P' / 13.1
coalesce(b.bw, 0) as bw   -- wsb_runs / 13.1
```
A player with **NO row** in `player_season_defense` gets `d_war = 0`, stored **identically** to a player measured at
exactly 0.000. And `total_hitter_war = o_war + d_war + bsr_war`, so their total silently treats **unmeasured defense
as league-average**.
```
d_war = 0 rows                          133,816 of 201,221
  ├ NO defense row (coalesce default)    73,345   ← "unknown", stored as 0
  └ genuinely 0.000 from real data        60,471   ← measured
bsr_war = 0 with NO baserunning row       58,119
```
## SCOPE — 38 rows actually matter, not 73,345
| division | defaulted players | verdict |
|---|---|---|
| **NJCAA_D1** | **5,218** | ✅ **EXPECTED** — the dRS engine has no JUCO coverage |
| D1 | 1,286 | mostly low-PA |
| D2 | 2 | — |
★ **D1 players with ≥50 PA and NO defense row: 38** (avg **131.3 PA**, max **270 PA**).
**Those 38 are real contributors credited with exactly-average defense on no measurement.**

## ⬜ NOT FIXED — needs a decision, and it is Trevor's
This is **[[feedback_zero_is_missing_not_a_value]]** ("exact-0 scouting % → `—`") surfacing in a NEW table. Options:
(a) leave as-is — treating unknown defense as average is a defensible modelling choice for a projection;
(b) distinguish them (NULL, or a `d_war_source` flag) so the UI can show `—` rather than 0.000;
(c) investigate why 38 D1 regulars have no `player_season_defense` row — the dRS engine covers 13,454 rows, so these
are genuine gaps in the engine's output, not a join failure.
🚨 **TRACK B:** whichever is chosen, the accumulator must carry the DISTINCTION (measured-0 vs no-data) rather than
collapsing both to 0 — a daily unattended run has no human to notice that a 270-PA hitter's defense was never measured.
