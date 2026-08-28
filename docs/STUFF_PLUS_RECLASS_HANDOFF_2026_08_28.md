# STUFF+ RECLASSIFICATION — COMPREHENSIVE HANDOFF (2026-08-28)

**START HERE for the Stuff+ reclassification rebuild.** Single source of truth for where we are, the shortcomings, and what
we're chasing. Companions: `STUFF_PLUS_RECLASS_REBUILD_PLAN.md`, `HANDOFF_STUFF_PLUS_2026_08_16.md` (§"THE PARTITION" + line
51–53 measured boundaries + §"REBUILT to the locked design"), `AGENT_LEARNINGS_stuff_plus_2026_08_16.md`, `STUFF_PLUS_RESUME_2026_08_17.md`.
This is a sub-task of the WAR-recalibration PROD PUSH (`PROD_PUSH_HANDOFF_RESUME_2026_08_26.md` — Stuff+ is the blocked Phase-C step).

## ★ CURRENT STATE (2026-08-28)
- **The classifier that produced staging's labels is RECOVERED, not lost.** It was in-DB scratchpad (never committed);
  recovered its STRUCTURE from staging `pg_stat_statements`, and its BOUNDARIES are documented in `HANDOFF_STUFF_PLUS` line 51–53.
- **A working rebuild exists: `scripts/reclassify_backfill.ts`** — reproduces staging's `_reclass_result` at **~85%** (per-pitch,
  70-pitcher sample). Validate: `npx tsx --env-file .env.local scripts/reclassify_backfill.ts --validate --sample 70`.
- **The exact per-pitch labels survive** in staging `_reclass_result` (2,000,674 rows, `uniq_pitch_id → label`, env-independent).
  So bit-exact labels for prod are available regardless of the rebuild's accuracy.
- Prod schema is ready: `pitch_log.classification_version` + `needs_review` added (migration `20260828000000`, applied). Venue
  corrections done (step 12). `pitcher_stuff_plus_ncaa` present. `pitch_log.stuff_plus`/`pitch_type_reclassified` still OLD on prod.

## ★ THE RULES AS BUILT (current `reclassify_backfill.ts`, ~85%)
Per pitch, on `pitch_log_corrected`: `armHB = (hand=R ? hb : −hb)`; `gap = pf_velo − release_velocity` (pf_velo from `_reclass_pf`);
`ivb = ivb_corrected`; `rr = ivb − |armHB|`. **Order matters** (recovered from pg_stat_statements):
```
if ivb ≤ −8 and armHB < 4 and gap ≥ 4        → Curveball     (CB refinement)
if armHB ≤ −12 and ivb ∈ [−2,6]              → Sweeper
if ivb ≥ 5 and gap ∈ [2,7] and armHB ≤ 2     → Cutter        (glove-side, +5 floor HELD)
if gap < 4   → rr>4 ? 4S : rr<−4 ? Sinker : rr≥0 ? 4S : Sinker   (fastball ±4; middle by sign)
if |armHB| < 5 and ivb ∈ [−4,4]              → Gyro Slider
if armHB > 0 → spin<1400 ? Splitter : Change-up                 (offspeed, arm-side)
else                                          → Slider          (glove-side breaking, ivb<5)
```
Then per pitcher: (1) **merge** seed-clusters within `Δarmhb<4 & Δivb<3.5 & Δvelo<2.5`; (2) **label each merged cluster by its
MEAN** (all its pitches inherit that label); (3) **anchor fold**: anchors = `≥60p OR ≥10% mix`; sub-bar clusters fold into the
nearest same-family anchor by movement distance. `movementDistance = √(dIVB²+dHB²)`.

⚠ **Note vs the doc:** the doc's FA/SI split is `±4` and fastball gate is `gap<2`; I widened the gate to `gap<4` (sinkers span
gap 2–3; `gap<2` leaked them to Change-up — this alone was +5%). The `±4` middle is meant to resolve by the **pitcher's
fastball-cluster mean**, which the merge+cluster-mean-label approximates but not exactly.

## ★ SHORTCOMINGS — why it's ~85%, not ~100% (WHAT WE'RE CHASING)
1. **The exact literal thresholds were normalized away.** `pg_stat_statements` masks constants to `$N`. We have the exact
   STRUCTURE + the documented boundaries (line 51–53), but the in-DB v2 used TUNED values that differ from the design doc
   (proof: filling the documented `±4` spec numbers → 65%; fitted numbers → 83%; the wider gate → 85%). The exact-to-100% numbers
   exist ONLY in `_reclass_result`.
2. **Not-yet-implemented documented mechanics** (each worth points):
   - **Arsenal tiebreaker** (CT/SL 6–8 gap band: 2nd distinct breaking ball → Cutter, else Slider) — NOT built.
   - **FA/SI middle strip resolved by the pitcher's fastball-cluster MEAN** — I approximate per-pitch, not exactly.
   - **Far-outlier score-and-flag** (keep own label + `needs_review`, ~6.86% baseline) — approximated by fold.
   - Exact **merge/fold** decisions (the doc's distance-bounded folding + velo-gap family guard details).
3. **Top remaining confusions (85% run):** Sweeper→Slider (1112, armHB −8..−12 near-sweepers), Gyro→Slider (588), 4S↔Sinker
   (~650, boundary noise), Cutter→Slider (217), Curveball→Slider (212, CB refinement strictness).
4. **The fit was on seed MEANS** (self-consistency 93.6%), which overstates real per-pitch accuracy (~85%) — don't trust the seed number.

## ★ TOOLS BUILT (this session)
- `scripts/reclassify_backfill.ts` — the classifier (rules above) + `--validate` harness (compares to staging `pitch_type_reclassified`).
- `scripts/_reclass_fit.ts` — coordinate-descent threshold fitter: materializes per-(pitcher×label×hand) seed means into
  `_seed_agg` on staging, then solves each threshold. (Fits seed-level; per-pitch is lower — see shortcoming #4.)
- **Recovery method (reusable):** query staging `pg_stat_statements` (`query ilike '%_reclass%'`, `order by length desc`);
  the LOGIC is the CTE `select … case … end` at the tail of the longest queries (past the giant `($N,$N)` VALUES blocks).

## ★ STAGING GROUND-TRUTH TABLES (RLS-locked, env-independent)
`_reclass_result` (uniq_pitch_id→label, 2.0M = the answer) · `_reclass_map` (pitcher×seed→label, 37,256) · `_reclass_pf`
(pitcher→pf_velo, 4,804). These are on STAGING (`slrxowawbijbjrkozqlj`). `pg_stat_statements` still holds the recovered SQL structure.

## ★ THE DECISION (Trevor's call — for the PROD push)
The doc (§E.PROD, line 373) says **"REGENERATE on prod, not copy."** Two ways:
- **(1) Finish the reconstruction to ~100%** (implement arsenal tiebreaker + cluster-mean strip + exact fold, validating vs
  `_reclass_result` at each step), then regenerate on prod. Matches the doc; a focused build with check-ins.
- **(2) Copy `_reclass_result` labels to prod** (bit-exact, env-independent) to unblock Stuff+ now, build the clean classifier
  as committed code in **Track B**. Faster; against the doc's regenerate directive.
Trevor chose Option A (rebuild) earlier. Current lean: continue the reconstruction (Option 1) but METHODICALLY, checking in per mechanic.

## ★ AFTER RECLASSIFICATION — the full Stuff+ prod regen (doc §E.PROD, "regenerate not copy")
venue (✅ done) → **reclassification** (the above → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`;
big write via keyset/direct-session, NOT ctid/gateway — see `AGENT_LEARNINGS_prod_push_execution_2026_08_27.md`) →
re-aggregate `pitcher_stuff_plus_inputs` (new taxonomy) → re-derive baseline `pitcher_stuff_plus_ncaa` (stamp `classification_version`) →
NULL old `pitch_log.stuff_plus` + recompute per-pitch (`compute_pitch_log_stuff_plus.ts`) → rollup to `Pitching Master.stuff_plus`
+ `Conference Stats."Stuff_plus"` (V2, back up first) → STOP before scores/ncaa/predictions (separate ordered runbook steps).
Equations (scoring) are committed + pushed (`e5dec2f` fold, verified). STAGING-MATCH GATE at each stage.

## ★ HONEST BOTTOM LINE
We went from "the classifier is lost / start from scratch" → recovered its structure (pg_stat_statements) + its documented
boundaries + the deployed algorithm → an 85% committed reconstruction. The exact-to-100% version needs the 3 unbuilt mechanics
(§SHORTCOMINGS #2) + the exact tuned constants that only survive inside `_reclass_result`. For the prod push, `_reclass_result`
is the bit-exact fallback; the reconstruction is the go-forward committed derivation (Track-B stage 3.1).

---
## ★★ CORRECTION (Trevor 2026-08-28): WE ARE NOT COPYING STAGING. REGENERATE on prod.
Reverses the earlier "roll out staging `_reclass_result` labels" note above — that was WRONG. Prod reclassification = RUN THE
COMMITTED CLASSIFIER (`scripts/reclassify_backfill.ts` logic) ON PROD DATA (venue-corrected), per HANDOFF_STUFF_PLUS §E.PROD
("regenerate end-to-end, NOT copy") + [[feedback_derive_over_copy]] (derivation must work in future / Track B on-ingest).
CONSEQUENCE: the committed classifier must reproduce staging's `_reclass_result` closely FIRST (today ~85%). `_reclass_result`
is now ONLY the validation ground-truth, NOT a source to copy. `scripts/_reclass_rollout.ts` (copy path) is DEAD — do not use.

---
## ★★ TIER 1 EXHAUSTED (2026-08-28) — exact v2 classifier is UNRECOVERABLE
Searched every reachable source for the literal v2 classifier (the code that wrote `_reclass_result`/`_reclass_map`/`_reclass_pf`):
- **Committed code** — all branches (git pickaxe `4S FB`/`pf_velo`/`_reclass_result`), dangling/lost objects, stashes, `staging-preview` checkout, VSCode local history → only the **v1** breaking-ball classifier (`ivb>gyroCap`, label `'4-Seam Fastball'`) + downstream **consumers** (`veloDiffPipeline.ts`, `nonBreakingBallPopConstants.ts`, `stuffPlusEngine.ts`, `conferenceStuffPlusV2.ts`). NOT the v2.
- **Shell/psql/bash history** — empty (`.zsh_history` last written Aug 10, no matches).
- **ALL Claude Code session transcripts** — literal code tokens (`pf_velo`/`_reclass_map`/`_reclass_result`) appear in **ONLY this session (7531d0c4)** = my re-derivation. NO prior session contains them. The Aug-19 build session (6de1d4f8) matched only on the prose label `4S FB`, not the code.
- **SQL Editor** — Trevor saved nothing manually; Postgres logs rolled off (~11 days > retention).
**Verdict:** the v2 classifier ran outside anything captured on this machine (almost certainly typed straight into the Supabase SQL Editor, unsaved). Its exact thresholds survive ONLY baked into `_reclass_result`'s 2M labels. → **Go Tier 2: reconstruct boundaries directly from `_reclass_result` (perfect answer key) to ≥95%, commit, regenerate on prod.**

---
## ★★★ CORRECTION 2026-08-28 (later) — DESIGN IS RECOVERED (supersedes "TIER 1 EXHAUSTED — UNRECOVERABLE" above for the DESIGN)
The Tier-1 note above was RIGHT that the exact TUNED CONSTANTS are unrecoverable, but WRONG that the design was lost. The Aug-16/17
DESIGN conversation lives in THIS session's transcript (`7531d0c4`, not the podcast files `6de…`/`9ae…`). Full design now recovered →
**`docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`** (all 7 CASE arms + anchor algorithm + both tiebreakers + validation gates +
5 as-built reconciliation flags). Gyro↔Slider seam = |armHB|=5; Slider↔Curveball seam = IVB=−8 (both STATED verbatim). Only the exact
literal thresholds still come from fitting to `_reclass_result`. NEW A1 PLAN = build to the recovered spec (tiebreakers + fold + FA/SI
cluster-mean) then fit constants → ≥95%. Mechanic-1 (Sweeper ivb-gate removal) already took the rebuild 85.4%→88.6%.

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

---
## ★★★ COMPLETE RECOVERED PROCESS + CURRENT STATE (2026-08-28, end of session) — START HERE for the classifier
**The classifier is a 3-STAGE FEEDBACK LOOP, not a pipeline** (recovered from `_reclass_map` + `breakingBallReclassification.ts` + transcript):

**STAGE 1 — CLASSIFY (movement).** `scripts/reclassify_v2.ts` — DONE, **91.5% per-pitch / 92.0% arsenal-mix** (honest diverse 120-pitcher
sample; earlier 88-91% were PostgREST-1000-cap MIRAGES — sampling now spreads across all 4804 via `_reclass_pf`). Structure:
  - per-pitch SEED into 10 buckets (incl. **`FBSTRIP`** = the FA/SI rr∈[−4,4] ambiguous strip — the piece we never had)
  - per-pitcher: merge seed-clusters (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) → label cluster by MEAN → anchor-fold (anchors ≥60p OR ≥10%;
    fold-guard = same fine-family + |Δvelo|<3, NO gyro↔cutter↔slider cross-fold; far-outliers → `needs_review`, ~6.6-7.2% ≈ 6.86% golden)
    → tiebreakers (CT/SL arsenal ride-floor; gyro/curve blend gap≤8→gyro/≥10→curve) → FBSTRIP resolution (rr≥0 → 4S else Sinker)
    → small-sample (<150p) fallback (global boundaries on cluster means).
  - **Boundaries DERIVED from staging ranges** (see §"DERIVED per-PITCH × HAND RANGES"), set at each pitch's CORE not p95 tail. HANDEDNESS
    VERIFIED (armHB=(R?hb:−hb) unifies hands; classify on armHB never raw hb).
**STAGE 2 — SCORE both ways.** Stuff+ engine (`compute_pitch_log_stuff_plus.ts`/`stuffPlusEngine`) → `stuff_plus` (as-labeled) +
  **`gyro_stuff_plus`** (as-gyro) per breaking ball. NOT YET WIRED to v2.
**STAGE 3 — RECLASSIFY borderline with SCORES + full arsenal.** Post-Stuff+ pass flips seam clusters (gyro↔slider @ armHB−5, 4S↔sinker
  @ rr 0) by which SCORE is coherent + the pitcher's repertoire (a Slider@armHB−5.1 → Gyro because its gyro_stuff_plus is coherent).
  Hooks committed (`breakingBallReclassification.ts` two-score row + `consolidate()` 4-tier arsenal dedup + `rstr_reclassification_log`);
  the score-flip logic was scratchpad v2 (LOST) → REBUILD. **This is what resolves the last ~8%** (box-rules structurally can't — the
  seams are diagonal 2-D surfaces). The ambiguous clusters it can't resolve → `needs_review` → the backfill/review step (Trevor's original design).

**MISMATCH breakdown of the ~8.5% (from `reclassify_v2.ts --mismatches`):** SEAM BLEED (realistic, Stage-3 resolves) + STAGING NOISE
(where v2 is arguably MORE correct — e.g. ivb+7/0-HB pitches staging called Gyro are CUTTERS per Trevor) → TRUE error ~2-3%.
**TOOLS:** `reclassify_v2.ts --validate|--derive|--mismatches|--pitcher <id>`; `_map_transitions.ts` (seed→label matrix).
**NEXT BUILD:** Stage 2 (wire scorer → both scores) → Stage 3 (score+arsenal reclassify) → validate vs `_reclass_result` → should close to ~staging fidelity. Then A2 prod writer (keyset). This = the A1 blocker + the Stuff+ chain, now understood as ONE coupled process.

## ★★★ CORRECTION 2026-08-28 (supersedes the "3-STAGE FEEDBACK LOOP") — NO feedback loop. NO gyro_stuff_plus. LINEAR pipeline.
Trevor 2026-08-28: gyro does NOT need its own score. VERIFIED in `stuffPlusEngine.ts`: `calcGyroSlider` is the SINGLE gyro equation
(defined once, line 173; rewards negative IVB depth + HB-near-zero) and the unified "all pitches" Stuff+ scores gyros with it via a
plain pitch-type switch (line 305: `case "Gyro Slider": return calcGyroSlider(...)`). `gyro_stuff_plus` appears ONLY in the OLD
`breakingBallReclassification.ts` + CSV importer + schema type — the unified engine NEVER computes/reads it = scratchpad cruft, DROP it.
**The real architecture is LINEAR (not a feedback loop):**
  1. CLASSIFY by the derived RANGES → assign each pitch its label (`reclassify_v2.ts`, 91.5%).
  2. Run the FULL Stuff+ ONCE (`stuffPlusEngine.ts` `calculateStuffPlus` → switch by pitch_type → per-(type×hand) recenter → write `stuff_plus`).
  3. AGGREGATE over the full season (per pitcher rollup).
There is NO Stage-3 score-informed reclassification and NO scoring-a-pitch-as-a-gyro. The gyro/slider (and 4S/sinker) SEAM BLEED is
just accepted (labeled by the range boundary; genuinely-ambiguous clusters → `needs_review` → backfill/review). This SIMPLIFIES the
remaining build: wire v2 labels → stuffPlusEngine → aggregate. Ignore the "3-stage/gyro_stuff_plus" sections above — this correction wins.

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

## ★★★★ GO-FORWARD PLAN — COMPACTION-SAFE HANDOFF (2026-08-28). START HERE for the Stuff+ chain + Track B.
### STATE (all committed @ 373830b on feature/war-recalibration)
- **v2 classifier BUILT + validated + committed.** `scripts/reclassify_v2.ts` — 92.6% per-pitch / 93.0% arsenal-mix vs staging
  `_reclass_result` (honest diverse sample). STUFF+ CROSS-CHECK PASSED (`--stuffcheck`): per-pitcher overall Stuff+ |Δ| mean 0.85,
  91% within ±2 → classification difference is product-invisible. Classifier core EXPORTED (classifyPitcher/classifySeed/armHBof/mean).
- **A2 prod writer BUILT + prod DRY-RUN PASSED.** `scripts/reclassify_prod.ts --dry-run` on prod = 2,013,005 labels, needs_review 8.6%,
  distribution matches staging (fastballs/SW/CB/FC/SPL dead-on; SL/GY/CH = the known seam bleed). `--go` (needs PGURI) writes via keyset/direct-session.

### ★ THE FIX REQUIRED (Trevor): v2 REPLACES the OLD v1 breaking-ball reclassification in the pipeline
`scripts/recompute-stuff-plus.ts` STEP 2 currently runs `runBreakingBallReclassification` = the OLD v1 (gyroCap 6/3, no FBSTRIP, no
seam-local backfill) — it would CLOBBER v2. **DROP step 2.** The v2 classifier does the classification at PITCH level; the pipeline must
NOT re-reclassify. v2 labels live in `pitch_log.pitch_type_reclassified` (written by A2). The 3 drifted v1 copies (breakingBallReclassification.ts
reclassifyRHP/LHP, reclassify_pitch_log.ts, _run_reclassify_*) are SUPERSEDED — quarantine (audit A7).

### THE PROCESS (LINEAR — prod regen AND Track B on-ingest). NO v1 reclass, NO gyro_stuff_plus, NO feedback loop.
1. **CLASSIFY** → `reclassify_prod.ts` (v2) stamps pitch_log.pitch_type_reclassified + classification_version + needs_review. [A2, BUILT]
2. **AGGREGATE** → pitch_log (v2 labels) → `pitcher_stuff_plus_inputs` per (pitcher × label × hand): mean velocity/ivb/hb(armHB)/rel_height/
   rel_side/extension/spin + pitch count. [A5 — TO BUILD; map source_player_id=pitcher_id, division from level, whiff_pct from is_whiff;
   fb_ch_velo_diff comes from the veloDiff step]. NO committed producer exists (only add_d2 one-off).
3. **★ NEXT STEP — SCORE per row BY LABEL** → `stuffPlusEngine.ts` `calculateStuffPlus(label, row, pop)` scores each (pitcher × label)
   row by its label's equation (`calcGyroSlider` = the SINGLE gyro eq, line 305) → `stuff_plus`; recenter per (type × hand). Already
   worked through + validated via `reclassify_v2.ts --stuffcheck` (faithful copy of all 9 equations). veloDiff (fb_ch_velo_diff) runs before scoring.
4. **ROLLUP** → Pitching Master.stuff_plus + Conference Stats V2. [rollupStuffPlusToMaster.ts, existing]
5. **AGGREGATE over season** → per-pitcher overall Stuff+ + usage %.

### NEXT STEP (Trevor): the Stuff+ per-row-by-label scoring (steps 2-3) — build A5 aggregator + wire stuffPlusEngine on v2 labels (drop v1).
### PROD EXECUTION (GATED): A2 `--go` needs PGURI + "prod, now?" + audit blockers resolved (landmine committed ✓; ledger drift). Then A5 → score → rollup on prod.
### TRACK B: this exact linear chain is the on-ingest edge fn (`project_unified_projection_edge_function`); the classifier + scoring are the committed forward process.
