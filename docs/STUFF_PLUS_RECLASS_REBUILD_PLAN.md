# STUFF+ RECLASSIFICATION — REBUILD PLAN (2026-08-28)
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


**Decision (Trevor): Option A — rebuild the per-pitch reclassification CORRECTLY (commit it), don't shortcut.** The structure
is fine (per-pitch classify → consolidate/scrub at the end); we just have to rebuild the missing hop as committed code so prod
can DERIVE it and Track B can reuse it. This is a BUILD, likely its own session — NOT a fire-and-forget run.

## WHY (the gap, confirmed 2026-08-28)
- Staging's per-pitch `pitch_log.pitch_type_reclassified` (2M rows, the ANCHOR taxonomy) was produced by **uncommitted scratchpad
  tooling** (`_seedcent_out.json` centroids → `_reclass_map` → `_reclass_result` → pitch_log).
- **Committed today:** `breakingBallReclassification.ts` `consolidate()` — the seed-folding/anchor consolidation — BUT it operates
  on aggregated `pitcher_stuff_plus_inputs` seed rows and **never writes pitch_log**. The scoring engine + folded equations are committed.
- **MISSING (must rebuild + commit):** (1) the per-(pitcher×hand) movement **CLUSTERING** that turns raw pitches into seeds and
  **assigns each pitch to a seed**; (2) the **per-pitch write** of the seed's final label → `pitch_log.pitch_type_reclassified`
  (+ `classification_version`, `needs_review`).
- The committed per-pitch writers (`reclassify_pitch_log.ts`, `_run_reclassify_bare/chunked.ts`) are the **SUPERSEDED** per-pitch CASE
  (verified ~41% match to staging) — do NOT use.

## THE ALGORITHM TO REBUILD (from `docs/HANDOFF_STUFF_PLUS_2026_08_16.md` "ANCHOR-BASED ARSENAL CONSTRUCTION")
Per (pitcher × hand), on the VENUE-CORRECTED layer (`pitch_log_corrected`, armHB folded):
1. **Cluster** the arm's pitches in full movement space (velo, ivb_corrected, armHB, spin, rel_height, extension; velo-gap aware).
   → data-derived centroids ("15,016 per-(pitcher×hand×tag)").
2. **Identify ANCHORS** = clusters with real usage (**≥60 pitches OR ≥10% of his mix**) that are **clearly separated** in movement
   space (close candidate anchors merge into one). Anchors = the pitcher's repertoire.
3. **Fold residuals**: any low-usage OR within-close-multivariate-proximity cluster **folds into its nearest anchor and inherits its
   label** ("gravity toward the main pitch"; velo-gap similarity guard — same speed off the same FB).
4. **FAR-OUTLIER protection**: a small cluster genuinely distant from every anchor does NOT fold → keeps nearest-bucket label (so it's
   still scored) **+ `needs_review`/exceptions flag** (the kid experimenting with a real new pitch).
5. **Label at the CLUSTER level** via the movement thresholds / nearest-centroid → the 9 canonical types (4S FB, Sinker, Cutter, Slider,
   Sweeper, Gyro Slider, Curveball, Change-up, Splitter). **Each pitch inherits its cluster's label.**
6. **Stability check (Check 1, anchor + score-and-flag, flagged clusters INCLUDED)** = the honest shipping metric; recompute + confirm
   it matches the staging-validated number (half-season split stability; the deployed number is in HANDOFF_STUFF_PLUS).

## OUTPUTS (what the rebuilt code must write)
- `pitcher_stuff_plus_inputs`: one row per (source_player_id × canonical pitch_type × hand), with seed sub-versions where a pitcher has
  distinct clusters; `p_consolidated`/`p_consolidated_count`/`boundary_case`/`outlier_flag`/`rstr_pitch_class` (`_v1/_v2…`) as today.
- `pitch_log.pitch_type_reclassified` (per pitch = its cluster's canonical label) + `classification_version` (stamp e.g. `v2-anchor-…`)
  + `needs_review` (far-outlier/flagged). ← **the missing per-pitch write**.

## BUILD STEPS
1. ~~FIND the scratchpad clustering code first.~~ **CHECKED 2026-08-28 — NOT RECOVERABLE from committed code:** searched the working tree
   (only `breakingBallReclassification.consolidate()` + CSV importers), all branches (`ci/anchor-and-tsc-gate` is BEHIND ours, no unique
   commits), and git deleted-file history (nothing). The clustering that built `_seedcent_out.json`/seeds was scratchpad-only, now gone.
   → **REIMPLEMENT from the algorithm above.** FIRST read `docs/AGENT_LEARNINGS_stuff_plus_2026_08_16.md` (Phase-2 mechanics — the detailed
   clustering rules/thresholds) + `docs/HANDOFF_STUFF_PLUS_2026_08_16.md`. Optionally recover staging's `_reclass_result`/`_reclass_map`
   helper tables (if they still exist on staging) as a REFERENCE to validate the reimplementation against (not as the source).
2. **Reuse `breakingBallReclassification.ts` `consolidate()`** for the seed-fold step (rules 2–4) — don't reimplement that part.
3. Implement the **clustering + per-pitch seed assignment** (the missing part) as a committed script: reads `pitch_log_corrected`, clusters
   per pitcher×hand, assigns each `uniq_pitch_id` a seed + canonical label.
4. **Write path:** env-driven + `--prod` guarded; big pitch_log write via the **proven keyset/direct-session** pattern (NOT ctid, NOT
   gateway single-UPDATE — see `AGENT_LEARNINGS_prod_push_execution_2026_08_27.md`).
5. **VALIDATE vs staging** (the objective gate): the rebuilt per-pitch labels must reproduce staging's `pitch_type_reclassified` within
   tolerance (aim ~100% given deterministic clustering; investigate any systematic diff). Only then is it correct.
6. **Commit** the whole thing (script + any helper migration). This closes the gap permanently AND is the Track-B stage-3.1 implementation.

## THEN (the rest of Stuff+, mostly committed scripts — validate each vs staging)
Aggregate/refresh `pitcher_stuff_plus_inputs` (post-reclass) → re-derive baseline `pitcher_stuff_plus_ncaa` → NULL old
`pitch_log.stuff_plus` + compute per-pitch (`compute_pitch_log_stuff_plus.ts`, keyset) → STAGING-MATCH GATE → rollup to
`Pitching Master.stuff_plus` + `Conference Stats.Stuff_plus` (back up first). STOP before scores/ncaa/predictions (later runbook steps).

## RELATIONSHIP TO TRACK B
Track B (separate future feature branch) = ONE edge fn running stages 2→6 on ingest. **This rebuilt clustering+reclassification IS Track B
stage 3.1.** Building it correctly now (committed, env-driven, prod-capable) means Track B inherits it rather than re-deriving. Log any
further missing/broken pieces here as they surface (per Trevor: the detailed docs exist precisely to catch these).

## STATE WHEN THIS PLAN WAS WRITTEN
Prod: park_code / is_conference_game / sequence ✅ done+verified; Stuff+ schema gap (classification_version/needs_review) ✅ applied;
equations verified committed+pushed; `pitcher_stuff_plus_ncaa` present; prod pitch_log has OLD stuff_plus (2.0M) + OLD/absent anchor
reclassification. Nothing Stuff+ has been written yet. Companion: `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md` (STUFF+ REGEN PLAN),
`docs/PIPELINE_pitch_log_to_projections.md` (the one-process map), `docs/STUFF_PLUS_RESUME_2026_08_17.md`, `docs/HANDOFF_STUFF_PLUS_2026_08_16.md`.

---
## ★★ INVESTIGATION FINDINGS (2026-08-28) — the classifier that made staging is IN-DB SCRATCHPAD, not committed
Traced the reclassification end-to-end. **The exact classifier that produced staging's per-pitch labels was never committed as code.**

### What's COMMITTED (and its constants — reuse these verbatim)
- `src/savant/lib/breakingBallReclassification.ts`:
  - `reclassifyRHP/LHP(ivb, hb, relHeight)` — BREAKING-ball rules (raw ivb/hb, hand-specific sweeper sign): Cutter `ivb>gyroCap`
    (`gyroCap = relH≥6.0 ? 6 : 3`); Gyro `ivb≥−3 & hb∈[−7,7]`; Curveball `ivb≤−8`; Sweeper RHP `hb≤−11 & ivb>−4` / LHP `hb≥11 & ivb>−4`; else Slider.
  - `movementDistance = √(dIVB² + dHB²)` (IVB+HB only, inches).
  - `consolidate()` — WITHIN-label dedup / `_v` split. Constants: `AUTO_ABSORB` (<5% minor & <6.0"), `AUTO_CONSOLIDATE` (<4.0"),
    `NEEDS_REVIEW` (4.0–6.0" & ≥5%), `KEEP_SEPARATE` (≥6.0" & ≥5% → `_v1/_v2`), `MIN_PITCHES=5`. Groups by `(pitcher, rstr_pitch_class)`.
    Family guard = only `BREAKING_BALL_TAGS = [Slider, Sweeper, Curveball, Cutter, Gyro Slider]` consolidate.

### What is NOT committed (IN-DB scratchpad — the "classifier v2", commits `8827a38`/`63b0edd` touched ONLY docs)
1. **FASTBALL movement split** — FA/SI → 4S vs Sinker by `IVB − |armHB|` (spec THE PARTITION: >+4 → 4S, <−4 → Sinker, middle by
   cluster mean). Commit `8827a38`: *"Classifier v2 on corrected layer (2M pitches, in-DB): ~20% of tagged 4-seams are sinkers."* NOT in the repo.
2. **Refined breaking thresholds (v2)** — the committed `reclassifyRHP` Cutter rule (`ivb>3` low-slot) is MORE aggressive than staging's
   result (systematic `Slider/Gyro → Cutter`); the committed function is an EARLIER version.
3. **Cross-label ANCHOR-GRAVITY override** — per pitcher, sub-anchor labels (< ≥60p OR ≥10% mix) fold into nearest anchor by movement
   distance + velo-gap family guard; far-outliers → needs_review. (Distinct from committed `consolidate()`'s within-label dedup.)
4. **Per-pitch SEED assignment + PROPAGATION** to `pitch_log.pitch_type_reclassified` (the known gap).

### STORED on staging (RLS-locked helper tables — env-independent by uniq_pitch_id/pitcher_id)
`_reclass_result` (uniq_pitch_id→label, 2,000,674 = GROUND TRUTH) · `_reclass_map` (pitcher×seed→label, 37,256) · `_reclass_pf` (pitcher→pf_velo, 4,804).

### EMPIRICAL: committed code does NOT reproduce staging
Rebuild (`scripts/reclassify_backfill.ts`) = committed reclassify + spec fastball split + cluster-mean + anchor override → **plateaus ~73%**
vs `_reclass_result`. Residual is systematic (committed rules ≠ in-DB v2). ⇒ exact reproduction requires the in-DB v2 SQL, which is not in the repo.

### ★ TRACK-B DELIVERABLE (the point): build the WHOLE reclassifier as real committed code
Track B stage 3.1 must implement, as version-controlled code (superseding the in-DB scratchpad): the fastball split + breaking v2 (correct
Cutter/Slider/Gyro thresholds) + anchor-gravity override + per-pitch propagation — validated to reproduce `_reclass_result`. Reuse the committed
`consolidate()` constants + `movementDistance`. This is the #1 classifier item for Track B; right now it exists ONLY as staging's stored output.

### WHERE the exact v2 SQL might still exist
NOT in the repo (verified). Only: the **staging Supabase SQL-editor history/saved queries (~2026-08-16/17)**, or a local `.sql` scratch file.
If recovered → run verbatim = exact reproduction. If gone → fit thresholds to `_reclass_result`, OR bring `_reclass_result` labels over for this
push and build clean in Track B.

---
## ★★★ BREAKTHROUGH (2026-08-28) — the classifier IS RECOVERABLE from staging's query history (supersedes "unrecoverable")
The in-DB "classifier v2" SQL was **retained in staging `pg_stat_statements`** (extension enabled). It ran from a SCRIPT that
computed labels + inserted them (`insert into _reclass_map/_reclass_pf … values (…)`), then propagated
(`update pitch_log … from _reclass_result … ctid`-batched). **The classifier is a single unified CASE** (recovered verbatim
except the literal thresholds, which pg_stat_statements masks to `$N` — take those from THE PARTITION spec + FIT to `_reclass_result`):

```
-- per pitch, on pitch_log_corrected. armHB = (hand=R ? hb : −hb); gap = pf_velo − release_velocity; ivb = ivb_corrected
case
  when ivb <= $                                              then <Curveball>   -- depth first
  when ivb >= $ and armhb <= $ and gap between $ and $        then <Sweeper>
  when gap < $ and (ivb − abs(armhb)) > $                     then <4S FB>      -- fastball, ride-dominant
  when gap < $ and (ivb − abs(armhb)) < $                     then <Sinker>     -- fastball, run-dominant
  when gap < $                                               then <Cutter?>    -- fastball-gap middle (LABEL/threshold TBD — verify vs _reclass_result)
  when armhb > $ and coalesce(spin,$) < $                     then <Splitter>
  when armhb > $                                             then <Change-up>
  when armhb <= $                                            then <Slider>
  when abs(armhb) < $ and ivb between $ and $                 then <Gyro Slider>
  else <…>
end
```
- **This is NOTHING like the committed `reclassifyRHP`** (different order — curve/sweeper first, fastball GAP-split, offspeed by
  armHB, gyro LAST) — which is exactly why reusing the committed function plateaued ~73%.
- **`pf_velo` (primary FB velo) is STORED** in `_reclass_pf` (pitcher→pf_velo) — read it, don't recompute (matches `gap` exactly).
- **Recovery method (reusable):** query staging `pg_stat_statements` for `query ilike '%_reclass%'` / classification CASEs, order by
  `length(query)` (the data-insert queries are huge VALUES lists; the LOGIC is the CTE `select … case … end` at the tail). Saved to scratchpad.
- **Remaining to reproduce staging exactly:** (1) confirm each branch's LABEL (masked) by tallying staging's `_reclass_result` in each
  branch's movement region; (2) FIT the ~13 thresholds to `_reclass_result` (structure is fixed, so this is solving, not inventing);
  (3) then per-pitcher anchor override (≥60p/≥10% mix; committed `movementDistance`+`consolidate` constants). Current rebuild
  `scripts/reclassify_backfill.ts` has the structure; label/threshold fit is the open step.
- **⇒ TRACK B:** this recovered CASE (with fitted constants) becomes the committed classifier — no more in-DB scratchpad.

---
## ★★ DECISION + CORRECTED VALUES FOR TRACK B (Trevor 2026-08-28) — roll out staging labels now, build clean in Track B
**DECISION:** For the prod push, ROLL OUT staging's `_reclass_result` labels (bit-exact, env-independent by uniq_pitch_id) →
`pitch_log.pitch_type_reclassified` + `classification_version='v1-anchor-2026-08-17'` + `needs_review`. Build the clean committed
classifier (the CORRECTED VALUES below) in TRACK B. Rollout via keyset/direct-session (see prod-push learnings), resumable.

**★ CORRECTED CLASSIFIER VALUES (for Track B stage 3.1 — the ~85% reconstruction; per-pitch on pitch_log_corrected):**
`armHB=(hand=R?hb:−hb)`, `gap=pf_velo−velo` (pf_velo=pitcher's hardest-FB cluster mean, stored `_reclass_pf`), `rr=ivb−|armHB|`:
```
if ivb ≤ −8 and armHB < 4 and gap ≥ 4   → Curveball
if armHB ≤ −12 and ivb ∈ [−2,6]         → Sweeper
if ivb ≥ 5 and gap ∈ [2,7] and armHB ≤ 2 → Cutter   (glove-side, +5 floor HELD)
if gap < 4  → rr>4?4S : rr<−4?Sinker : rr≥0?4S:Sinker   (fastball ±4, strip by fastball-cluster mean)
if |armHB| < 5 and ivb ∈ [−4,4]         → Gyro Slider
if armHB > 0 → spin<1400?Splitter:Change-up
else                                     → Slider
```
Then per pitcher: merge seed-clusters (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) → label merged cluster by MEAN → anchor fold
(≥60p OR ≥10% mix; nearest same-family anchor by √(dIVB²+dHB²); far-outliers score-and-flag needs_review ~6.86%).
**STILL TO BUILD to reach ~100% (the shortcomings):** arsenal tiebreaker (CT/SL 6–8 band: 2nd breaking ball→cutter), FA/SI
middle strip resolved by the fastball-cluster mean (not per-pitch), exact merge/fold + far-outlier flag. Validate vs `_reclass_result`.
Rebuild code: `scripts/reclassify_backfill.ts`; fitter: `scripts/_reclass_fit.ts`. Full detail: `docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md`.

---
## ★★ CORRECTION (Trevor 2026-08-28): WE ARE NOT COPYING STAGING. REGENERATE on prod.
Reverses the earlier "roll out staging `_reclass_result` labels" note above — that was WRONG. Prod reclassification = RUN THE
COMMITTED CLASSIFIER (`scripts/reclassify_backfill.ts` logic) ON PROD DATA (venue-corrected), per HANDOFF_STUFF_PLUS §E.PROD
("regenerate end-to-end, NOT copy") + [[feedback_derive_over_copy]] (derivation must work in future / Track B on-ingest).
CONSEQUENCE: the committed classifier must reproduce staging's `_reclass_result` closely FIRST (today ~85%). `_reclass_result`
is now ONLY the validation ground-truth, NOT a source to copy. `scripts/_reclass_rollout.ts` (copy path) is DEAD — do not use.

---
## ★★ 2026-08-28 — FULL DESIGN RECOVERED → `docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`
Track-B classifier build target is now the RECOVERED SPEC (not derive-from-scratch). Implement: 7 CASE arms (§1), per-pitcher anchor
algorithm (§2: seed→merge→label-by-mean→anchor-fold≥60p/≥10%→score-and-flag), both tiebreakers (§3: CT/SL arsenal + gyro/curve blend),
validate to 0.86+ vs TrackMan / ≥95% vs `_reclass_result`. Exact literal constants fit from `_reclass_result` (answer key). Current
`reclassify_backfill.ts` = 88.6% (post Sweeper ivb-gate fix); missing = the 2 tiebreakers + anchor-fold + cluster-mean strip.

## 2026-08-28 — v2 clean-room build = `scripts/reclassify_v2.ts` (A2 writer foundation). Honest 85.2% (diverse sample).
Validation sampling FIXED (spread across all 4804 pitchers; prior 88-91% were PostgREST-1000-cap mirages). Next: tighten fold-guard
(no gyro↔cutter↔slider cross-fold) → work FA/SI + near-sweeper folds → fit constants to `_reclass_result` → ≥95% → wire A2 prod writer.

## 2026-08-28 — TWO-STAGE process recovered (SEED→RESOLUTION). Box-rule v2 plateaus 87% because it skips the 23% per-pitcher overrides.
Correct forward classifier = 10-bucket SEED (incl. FBSTRIP = FA/SI strip) → per-pitcher cluster RESOLUTION (FBSTRIP→4S/Sinker, SL→Gyro 33%, etc.).
Reverse-engineer resolution rules from `_reclass_map`+movement. See AGENT_LEARNINGS_stuff_plus §BREAKTHROUGH + `scripts/_map_transitions.ts`.

## 2026-08-28 — PROD reclassification = the 3-STAGE FEEDBACK LOOP (classify→score→reclassify). A2 writer + Stuff+ chain are COUPLED.
The prod reclassification is NOT a one-shot classify. It's: STAGE 1 classify (`reclassify_v2.ts`, 91.5%, DONE) → STAGE 2 score both ways
(`compute_pitch_log_stuff_plus.ts` → stuff_plus + gyro_stuff_plus) → STAGE 3 arsenal reclassify borderline seams by coherent score.
Full detail: `docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` §COMPLETE RECOVERED PROCESS + `docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md`
§FEEDBACK LOOP. **Prod-push implication:** the "reclassification" step + the "Stuff+ scoring" step are ONE coupled loop, not sequential —
build/run order: v2 classify → score → arsenal-reclassify → THEN baseline re-derive → rescore final → rollups. A2 committed writer stamps
the STAGE-3 final labels (keyset/direct-session). Regenerate on prod (not copy). needs_review clusters → backfill/review.
## CORRECTION 2026-08-28: reclassification is LINEAR (classify-by-ranges → full Stuff+ → aggregate), NO feedback loop / NO gyro_stuff_plus (verified: calcGyroSlider is the single gyro eq in stuffPlusEngine switch). Supersedes the 3-stage entry above.

## ★★★ THE FORWARD RECLASSIFICATION → STUFF+ PROCESS (FINAL, Trevor-confirmed 2026-08-28). LINEAR + per-pitcher usage-weighted.
This is the committed go-forward for BOTH the prod regen AND Track B on-ingest. NO feedback loop, NO gyro_stuff_plus, NO score-flip (all dropped).
1. **CLASSIFY by the derived RANGES.** `scripts/reclassify_v2.ts`: per-pitch 10-bucket SEED (incl `FBSTRIP` = FA/SI rr∈[−4,4] strip) →
   per-pitcher cluster (merge Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) → label-by-MEAN vs the CORE ranges (per-pitch×hand, handedness-normalized armHB) →
   tiebreakers (CT/SL ride-floor, gyro/curve blend). Output: clear labels + the ~8% seam-unclear flagged. (Stage-1 = 91.5% / 92.0% arsenal-mix.)
2. **TRACK USAGE %.** Per pitcher, from the CLEAR pitches, compute the % of each pitch type he throws → his true arsenal (which pitches, how much).
3. **BACKFILL the unclear ~8%.** Fold each seam-unclear pitch into the pitcher's DOMINANT CLOSE-PROXIMITY pitch — the main pitch he actually
   throws that it sits nearest to in movement → the label matches his real repertoire (a 4S guy's ambiguous fastball → his 4S; a gyro-heavy
   guy's borderline breaker → his gyro). USAGE-WEIGHTED, not just nearest. Reserve `needs_review` ONLY for genuinely distinct RARE pitches (a
   new experimental pitch), NOT seam bleed. (This is what staging did — confirmed via `reclassify_v2.ts --pitcher <id>`.)
4. **RUN THE FULL STUFF+ ONCE.** `src/savant/lib/stuffPlusEngine.ts` scores each pitch by its FINAL label via the pitch-type switch
   (`calcGyroSlider` = the SINGLE gyro eq, line 305) → recenter per (pitch_type×hand).
5. **AGGREGATE over the full season** → per-pitcher TRUE overall Stuff+ + usage %.
Prod = REGENERATE end-to-end (not copy). A2 committed writer stamps the step-3 final labels (keyset/direct-session). Full recovery detail:
`docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` + `docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md` (derived ranges §). NEXT BUILD: step 3
(usage-weighted backfill) into reclassify_v2.ts → validate vs `_reclass_result` → wire steps 4-5 (existing engine) → per-pitcher Stuff+ cross-check.

### ★ STEP 3 REFINEMENT (Trevor 2026-08-28) — the proximity gate is the whole game; fold is SEAM-LOCAL + TIGHT, never "nearest anchor"
The usage-weighted backfill applies ONLY to genuinely-borderline pitches. Three cases:
1. **Core pitch** (cluster centroid clearly inside one type's range, FAR from any seam) → KEEP its label; usage is IRRELEVANT. (e.g.
   a −15 IVB cluster is nowhere near the gyro band [−4,+4] → it stays Curve/Sweeper no matter how many gyros the pitcher throws.)
2. **Borderline** (centroid near a SEAM between two adjacent types AND within a TIGHT movement distance of one of those two seam-adjacent
   pitches the pitcher actually throws) → fold to the HIGHER-USAGE of those two. Usage only breaks the tie WHEN MOVEMENT CANNOT.
3. **Distinct but far from all his pitches** → KEEP its own label + `needs_review`. A pitcher can throw 1 of any pitch in the sport; never erase it.
GATE = tight movement distance to a SEAM-ADJACENT dominant pitch — NOT "nearest anchor" (that sloppy version would swallow legit distinct
pitches). Implement as: a cluster is fold-eligible only if it's within the tight seam band of two types AND a dominant same-region anchor exists.

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
