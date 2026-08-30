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
> - **PROD:** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
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
**THE FIX ALREADY EXISTS AND IS NOT A MIGRATION:** `scripts/sql/team_drs_store.sql` — it lives in `scripts/sql/`, NOT in
`supabase/migrations/`, which is exactly why staging got it (2026-08-09) and prod never did. `PROD_MIGRATIONS_TODO.md:234`
records it as "APPLIED STAGING … PROD pending."
**VERIFIED it lands cleanly on prod:** 308 hardcoded `(source_team_id, drs)` values, **sum = −0.007** (correctly centered) ·
**308/308 match prod `team_war_snapshots` season 2026** (prod has 466 rows; the 158 non-D1 correctly stay NULL) ·
**5,375/5,375** prod D1 pitchers with IP>0 resolve `TeamID → Teams Table.source_id → team_drs` (full coverage, zero
fallthrough to `drs_behind = 0`). `:2` is `add column if not exists` → idempotent.
⚠ **DO NOT source these values from staging** — staging's `team_war_snapshots.team_drs` is now **0/308 non-null** (the
table was rebuilt after the 2026-08-09 populate). `scripts/sql/team_drs_store.sql` is the ONLY surviving source of truth.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` 31,467 vs staging 15,561 resolves better). **D30 is a no-op re-run — dry-run to confirm, then skip.**
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
D29b (NEW)  PASTE scripts/sql/team_drs_store.sql in the Supabase SQL editor. ⛔ never `--linked`
            (config.toml still names a third ref kfkuhdmpchxyffmnowgj). Idempotent.
            GATE: select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;   EXPECT 308 and ~-0.01
            Then tick PROD_MIGRATIONS_TODO.md:234.
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
D33         ⛔ SKIP. CSV-only output (`:36` writes team_drs.csv), no DB write anywhere, and `:13` hardcodes
            `./.env.local`. D29b already supplies the values it would derive. If ever run it must be LAST (it reads the
            Masters that D31/D32 write) — the checklist ordering that puts it before D30/D31 is WRONG.
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
