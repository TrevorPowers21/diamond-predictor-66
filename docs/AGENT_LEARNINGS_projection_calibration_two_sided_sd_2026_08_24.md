# AGENT LEARNINGS — Projection calibration: the z-shift over-projects the extremes; the fix is a two-sided (split) SD (2026-08-24)

Status: **DIAGNOSIS COMPLETE + METHOD CONVERGED (two-sided SD). NOT YET IMPLEMENTED.** Two items to lock before building: the sample qualifier + the HR9 holdout.

## ★★★ DOCTRINE (write into the audit doctrine section, verbatim — Trevor 2026-08-24) ★★★
> "The 'how was this missed' answer is the most valuable part of the writeup, and it generalizes: every audit verified code matches spec and constants match the mean and SD, and both were true. Nothing verified that the model's output matched reality across the range, and a bug calibrated perfectly at the mean is invisible to every mean-based check."

**Standing check to add to every modeling review:** does the model's OUTPUT make logical sense against reality **across the whole range** (elite + poor tails), not just at the mean? A calibration-binning check (actual stat vs projected, by power-rating bin) catches this in one query. Mean-based checks (league-avg wRC+ ≈ 100, coverage/nulls, formula parity) are all blind to a tail that's broken.

## THE BUG
Pitcher (and hitter) forward projections over-project the ELITE tier — badly enough to produce **impossible values**: 66 pitchers projected NEGATIVE HR9 (min −0.23), 698 (11%) below 0.4; elite ERA projected 1.13. This inflated pWAR and put below-average-Stuff+ mid-major arms (e.g. Simon Yochum, Davidson, Stuff+ 88.6) at the top of the projected leaderboard. Surfaced by Trevor eyeballing the top of the board — invisible to every prior audit (see doctrine).

## THE MECHANISM (`src/lib/pitcherProjection.ts:170`, mirrored on the hitter side)
```
zShift        = ((PR+ − 100) / prSD) × ncaaSD      // PR+ = power rating; prSD = rating SD; ncaaSD = stat SD
powerAdjusted = ncaaAvg ∓ zShift
blended       = 0.30·lastYear + 0.70·powerAdjusted
projected     = blended × (1 ∓ classAdj ∓ devAgg·0.06)
```
Two hidden, wrong assumptions:
1. **Correlation = 1.** The map treats a 2.44-SD *rating* as a 2.44-SD *better stat*. Real correlations (2026, IP≥40 / PA≥100): HR9 0.32 · ERA 0.46 · WHIP 0.51 · K9 0.70 · BB9 0.90 · AVG 0.42 · OBP 0.64 · ISO 0.55. Matching the SDs does NOT capture this — SD gives each variable's spread, not how tightly they track. (Also: it was a KNOWN gap — damping was disabled 2026-05-05 on the wrong belief that the 0.7 last-year blend regresses to the mean; it regresses to LAST YEAR. The re-enable was deferred as "Path B", memory `project_pitcher_damping_path_b.md`.)
2. **Symmetric SD on a skewed stat.** Pitching rates are right-skewed — the good side is compressed (elite ERA bottoms ~1.8–2.5, HR9 ~0.3), the bad side runs wild (10+ ERA). A single SD is inflated by the bad tail, so applying it symmetrically over-projects the compressed good side straight through the physical floor.

## WHAT WE REJECTED (and why)
- **A floor** — masks broken math; "lazy data science" (Trevor). Elite HR-preventers going negative means the *math* is wrong, not that it needs a clamp.
- **Uniform Pearson-`r` shrink** — OVER-compresses the good stats. It squashed elite AVG to .318 in a .280 league (useless — .318 is not elite) and elite ISO to .239 (real .294–.45). A projection tool whose "elite" is barely above average fails its one job. "Statistically correct" (regression-to-noisy-mean) is NOT correct when the elite is real and repeatable.

## THE FIX — TWO-SIDED (SPLIT) SD (Trevor's insight, data-proven)
Compute the spread of the GOOD side of the mean separately from the BAD side (semi-deviation / split-normal). Use `sd_good` when the rating projects a player toward elite, `sd_bad` toward poor. The math then recognizes direction and scales correctly — no floor, no dial.

**Definition of "realistic SD" (reproducible, no human in the loop):**
> On the QUALIFIED population (min IP / min AB — a real sample), compute the mean; then `sd_good` = RMS of deviations of players BETTER than the mean, `sd_bad` = RMS of those WORSE. Scale elite projections by `sd_good`, poor by `sd_bad`. The edge fn re-derives these from each season's actuals.

**Proof (2026, IP≥40 / PA≥100), elite (p95-rated) projection:**
| Stat | sd_good | sd_bad | asym (bad/good) | current (1 SD) elite | TWO-SIDED elite | actual p90/p95 |
|---|---|---|---|---|---|---|
| ERA | 1.55 | 2.27 | 1.47 | 1.85 | **2.52** | 3.35/2.90 |
| WHIP | 0.256 | 0.338 | 1.32 | 0.99 | **1.07** | 1.18/1.10 |
| BB9 | 1.31 | 1.73 | 1.33 | 1.35 | **1.73** | 2.30/1.95 |
| K9 | 2.31 | 1.97 | 0.85 | 12.3 | **12.6** | 11.4/12.3 |
| AVG | .055 | .050 | 0.90 | .379 | **.384** | .360/.383 |
| ISO | .106 | .074 | 0.70 | .309 | **.333** | .294/.344 |
| HR9 | 0.48 | 0.64 | 1.31 | **−0.01** | **0.14** | 0.42/0.29 |

- **Asymmetry column confirms the skew read:** pitching 1.3–1.5 (bad side wider), hitting 0.7–0.9 (symmetric / ISO upside-skewed).
- Two-sided lands ERA at **2.52** (dominant-arm target), everything else within ~0.02–0.05 of the real elite. **No floor, no dial.**

## THE ONE HOLDOUT: HR9 (still open)
Two-sided moves HR9 from impossible (−0.01) to 0.14, but real elite is 0.29–0.42 — still overshooting, and it's the ONLY stat that resists. Cause: HR9's *rating* is the weakest predictor (corr 0.32 — barely tracks actual HR9), so no SD trick rescues a rating that doesn't rank HR9. NOT to be floored. Open question: is the HR9 **composite over-inflating ratings** (the 2026-08-11 gb/pull-heavy refit pushed ratings to 178–200), or does HR9's genuinely weak signal warrant more regression (justified by the measured `r`, not an arbitrary dial)?

## OPEN ITEMS (lock before building)
1. **Sample qualifier** — used IP≥40 / PA≥100. Test 25/40/60 IP and set the threshold from how `sd_good` moves, not by picking one.
2. **HR9** — diagnose the over-reach (inflated composite vs weak signal) and fix for the right reason.

## THE PLAN (once the method + qualifier + HR9 are locked)
1. Compute per-stat two-sided `sd_good`/`sd_bad` (+ mean, qualifier) on staging.
2. **Store how they were calculated** — the qualifier, the semi-deviation method, and the values — in `model_config`, read identically by returner, transfer, and the edge fn.
3. **Wire into the automatic edge function** so it re-derives the SDs from each new season's actuals (self-updating year over year).
4. Re-run all precomputes; re-verify the calibration table (actual vs projected across the range).
5. Add the doctrine + the across-the-range calibration check to the audit doctrine.

## 🛑 MUST READ — TWO CONSTANTS IN THIS DESIGN WERE WRONG (found 2026-09-01)

The METHOD below (two-sided SD, `sd_good`/`sd_bad`, HR9 shrinkage) is correct and shipped correctly.
**Two POPULATION choices around it were not**, and both produced the same signature: projections
uniformly biased at every percentile and in every class bucket.

**(1) THIS DOC NEVER SPECIFIED A DIVISION.** It says *"On the QUALIFIED population (min IP / min AB — a
real sample)"* — a volume qualifier and nothing else. The producer therefore filtered on `Season` only,
and the "NCAA" baselines were computed across EVERY division. On prod at `IP >= 40`:
`D1 1,295 (mean ERA 5.264) · NJCAA_D1 477 (6.118) · ALL 1,773 (5.492)`. **477 JUCO pitchers — 27% of the
sample — inflated the D1 anchor by 0.229 ERA (4.3%).** `git log` confirms a division filter was never
present. ⇒ **Any future calibration MUST state its division as explicitly as it states its qualifier.**

**(2) THE Z-SHIFT SUBTRACTS 100, BUT PR+ IS NOT CENTERED AT 100 HERE.** The mechanism block below writes
`zShift = ((PR+ − 100) / prSD) × ncaaSD`. True centers on D1/`IP>=40`: era 109.73 · fip 108.29 ·
whip 108.40 · k9 101.69 · **bb9 123.16** · hr9 102.04. On the all-division/`IP>=20` population they are
96.3–104.0 (≈100) — PR+ was FIT there and APPLIED here, giving every qualified pitcher a free head start
(**+0.44 ERA**). Fixed by storing `<key>_pr_center` for all 11 ratings and measuring the z from it.

★ **THE DOCTRINE BELOW CAUGHT ITS OWN BLIND SPOT.** This doc's standing check is *"does the model's OUTPUT
make logical sense against reality ACROSS THE WHOLE RANGE"* — and it does, because a miscentered rating is
a CONSTANT offset: the shape stays right and only the level moves. **A range check catches a broken tail;
it does not catch a uniform shift.** The tell was the opposite of a tail problem — *equal* discrepancies in
every bucket. ⇒ Add to the doctrine: **a constant offset with correct spread points at a population
mismatch in the constants, not at the model.**

Full detail + the fix: `docs/PIPELINE_pitch_log_to_projections.md` stage 5.5 MUST READ.

## ⚖️ THE WEIGHTING QUESTION — asked and answered 2026-09-01

Trevor: *"are you scaling it by row or by IP?"* — the right question, and it exposed an **undocumented
choice** rather than a defect.

**ANSWER: per-row.** `twoSided()` is `sum(vals)/vals.length`; every qualified pitcher counts once.

**WHY THAT IS DEFENSIBLE HERE.** A projection ranks a PLAYER against other PLAYERS, and volume is
already carried separately by `projected_ip` through the depth role. Folding innings into the rate
baseline would let workhorses define "average," which answers *"the average inning"* — a run-environment
question, not a projection question. That is precisely why conference/region baselines ARE IP/PA-weighted
([[feedback_weighted_region_averages]]) while this is not: **two conventions, two purposes.**

**MEASURED (PROD, D1, IP>=40):** ERA anchor 5.2635 per-row vs 5.1325 IP-weighted (−2.5%); BB9 −3.3%;
FIP −1.6%. Rating centres move the OTHER way: era 109.725 → 111.413, bb9 123.161 → 126.606 — because
better pitchers throw more innings, weighting lowers the stat anchor AND raises the rating centre.

🛑 **THE REAL HAZARD IS NOT THE CHOICE — IT IS MIXING.** An IP-weighted centre with a per-row anchor
offsets every projection by ~1.7 rating points ≈ **0.09 ERA**, silently and uniformly. That is C1 in
miniature: *a constant fit on one frame applied to another.* They are safe today only because both come
from the same expression over the same rows.

★ **GENERALISED RULE, worth carrying beyond this file:** whenever a formula has a CENTRE and a SCALE,
they must be derived from the **same population by the same method**, in the same commit. Every
projection bug found on 2026-09-01 — the missing division filter, the assumed rating centre of 100, and
this — is the same failure: **two halves of one equation sourced from different populations.**

## ★ BUILD STATUS (2026-08-25) — PITCHING BUILT + VERIFIED on staging
- **Producer** `scripts/compute-projection-calibration.ts` (stage 5.5) — computes per-stat calibrated mean + `sd_good`/`sd_bad`
  on the qualified pop; HR9 shrinkage (data-K=71) baked into HR9's mean/SD. Writes `<stat>_plus_ncaa_avg/_ncaa_sd/_ncaa_sd_bad`
  to model_config. **APPLIED STAGING** (19 keys; era 5.475/1.545/2.265, hr9 1.076/0.213/0.271, K=70.8).
- **Code** (commit `57e8f12`): `pitchingEquations` type/defaults/merge-reader gain `<stat>_plus_ncaa_sd_bad`; `projectPitchingRate`
  (returner) + `transferPitcherProjection.dsd()` (transfer, 6 sites) use the directional SD (rawZ≥0 → sd_good, else sd_bad).
  Covers returner, transfer, TB sim, PitcherProfile. 0 new tsc errors, 265 tests pass. Batch overlays the model_config keys.
- **VERIFIED (Arkansas re-run):** Yochum projHR9 **0.15 → 0.61**, pWAR **2.31 → 2.05**, pRV+ 151 → 142. HR9 negatives collapsed
  ~66 → 3 (0.06%), 0% below 0.3. Systematic over-projection fixed.
- **REMAINING:** (1) full re-run — all 17 customer teams (transfer) + returner-pitcher batch; the `propagate` SQL step needs the
  raised statement_timeout (big-write). (2) **edge fn (Deno) `process-precompute-jobs`** mirror of the directional SD — Trevor
  deploys. (3) **hitters** (AVG/OBP/ISO) — symmetric, deferred follow-on (different model_config key convention). (4) ~3 residual
  negative HR9 = an individual pitcher's OWN noisy last-year HR9 in the 0.3/0.7 blend (calibration shrink doesn't touch the
  per-pitcher input) — optional: shrink the last-year input too. (5) re-bake snapshots + markets after the full re-run.

## ★ FULL RE-RUN + RE-BAKE — DONE + VERIFIED on staging (2026-08-25)
- **Transfer (18 customer teams)** `precompute-pitchers --apply` — done, 0 propagate timeouts. Overlays model_config `_plus_ncaa_` (incl. `_sd_bad`) already.
- **⚠ RETURNER OVERLAY GAP (found + fixed, commit `3c4e8c8`):** `precompute-returner-pitchers` only overlaid `p_*` power weights, NEVER the `_plus_ncaa_` means/SDs → it ran on stale symmetric code-defaults. Added the same overlay `precompute-pitchers` has. **PROD: the returner batch needs this overlay too, or returners ignore the calibration.** Re-run → returner HR9 negatives 63 → 19.
- **Re-bake** `backfill-neutral-snapshot` (bp 1205 / tb 167) + `heal-stale-snapshots` (561/561, 0 err) + `resync-target-snapshots` (markets already consistent) — snapshots now carry the new pitcher WARs/markets.
- **VERIFIED board:** top-12 projected returner pitchers are ALL genuine stuff (Stuff+ 99–113: Flora 113 / Blair 110 / Volantis 108) — **0 weak-stuff mid-major arms at the top** (the reported bug, fixed). Yochum 0.15→0.61 / pWAR 2.31→2.05.

## ★ THE 19 RESIDUAL NEGATIVE HR9 — INVESTIGATED (2026-08-25): a SAMPLE-QUALIFICATION gap, NOT calibration
Pulled all 19 negatives' inputs: **every one has IP = 0–5 (mostly 1 IP) and lastHR9 = 0.00.** They barely pitched and
trivially allowed 0 HR in ~1 inning. Even a *below-average*-rated one (Owen Pincince, hr9_pr_plus 45) goes negative — so it's
NOT the rating/SD. Root cause: these are sub-threshold pitchers getting a full projection off ~1 inning of noise.
**Key inconsistency:** the returner batch ALREADY nulls JUCO pitchers under 20 IP (1,167 of them per the run log), but **D1
pitchers under ~5 IP slip through.** So the negatives are a qualification gap, not a two-sided-SD failure. They're 0.29% of
returners and don't top the board (≈0 pWAR value). **Fix options (Trevor's call — investigate-only for now):**
(a) apply a min-IP qualification to D1 returner projections (null sub-X-IP, mirroring the JUCO sub-20-IP nulling);
(b) per-pitcher last-year shrinkage — for IP=1, `IP/(IP+K=71)` pulls lastHR9 essentially to the league mean, so the blend
    can't go negative; (c) both. Not a floor either way — it's fixing garbage-in on ~1-inning pitchers.

## WHERE IT LIVES IN THE EDGE FUNCTION (pipeline placement, per `PIPELINE_pitch_log_to_projections.md`)
The two-sided SD recompute is a **NEW calibration stage 5.5**, between the Masters/ratings/conference baselines and the projections:
```
Track B on-upload chain:  2 derive → 3 Stuff+ → 3b season-stats → 4 power ratings → 5 conf baselines
                          → 5.5 PROJECTION CALIBRATION (NEW)  → 6 projections → 7 NIL
```
- **Stage 5.5 (new):** on the QUALIFIED population (min IP/AB), compute per-stat mean + `sd_good`/`sd_bad` (and `pr_sd` from
  the Stage-4 ratings). Write to `model_config` (keys per stat, e.g. `hr9_sd_good`/`hr9_sd_bad`/`hr9_ncaa_avg`/`hr9_qual_min_ip`).
- **Stage 6 (projections)** reads those from `model_config` — identical for returner, transfer, and the edge fn. Directional:
  use `sd_good` when projecting toward elite, `sd_bad` toward poor.
- **Run in tandem, front-to-end:** when built, execute the WHOLE chain (2→…→5.5→6→7) on staging in one pass and re-verify the
  across-the-range calibration table + WAR/market — so the new SD is proven working from ingest through display, not in isolation.

## QUALIFIER SENSITIVITY (2026 data — set the min IP/AB from this, not by guess)
`sd_good / sd_bad` tighten as the qualifier rises (garbage-removal effect); asymmetry (pitching) persists at every threshold:
| stat | IP≥25 (n=3401) | IP≥40 (n=1802) | IP≥60 (n=705) |
|---|---|---|---|
| ERA | 1.87/2.94 | 1.55/2.27 | 1.20/1.50 |
| HR9 | 0.55/0.77 | 0.48/0.64 | 0.42/0.49 |
| WHIP | 0.30/0.42 | 0.26/0.34 | 0.20/0.23 |
| BB9 | 1.53/2.27 | 1.31/1.73 | 1.02/1.28 |
| K9 | 2.40/2.05 | 2.31/1.97 | 2.32/1.99 |
Hitters symmetric at all PA thresholds (AVG/OBP good≈bad; ISO upside-skewed). Leaning IP≥40 (real sample, n=1802) / PA≥100 — **Trevor to confirm.**

## HR9 DIG (2026, IP≥40, n=1802) — why the composite is a weak predictor (corr 0.32)
Correlation of each HR9-composite INPUT with actual HR9:
| input | current weight | corr w/ HR9 |
|---|---|---|
| barrel_pct | **0.15** | **0.273** (strongest — barrels ARE HRs) |
| hard_hit_pct | 0.30 | 0.238 |
| ground_pct | 0.30 | −0.228 (legit — grounders suppress HR, Trevor's intuition confirmed) |
| h_pull_pct | **0.25** | **0.111** (weakest) |
| → composite | | **0.32** (barely beats barrel alone) |
**Finding:** groundball is NOT the culprit (it's a real predictor). The current weights double-count hard contact (barrel ⊂ hard_hit) and over-weight pull. Multiple regression (discounts the double-counting) → optimal weights barrel 0.22 / hard_hit 0.28 / ground 0.35 / pull 0.16.

**★ DECISIVE (2026-08-25): re-weighting HR9 is a DEAD END.** Even with the optimal weights, the composite improves only
0.32 → **0.335 (multiple R)**. The inputs cannot predict HR9 better than ~0.33 correlation — HR9 is inherently the least
predictable stat. So HR9 is NOT fixed by weights.
**HR9 handling (data-earned, not a floor/dial):** because the rating can't identify elite HR9 (a top-*rated* HR9 arm actually
gives up ~0.78 HR9 on average, vs the 0.29 p95 *outcome*), HR9's projection **regresses toward the mean by its measured signal
strength (~0.33)** → elite HR9 lands ~0.6–0.8 (= the actual top-rated mean, and Trevor's stated comfort ~0.84). The other 6 stats
rank players well, so the two-sided SD lands their elite correctly with no extra regression. The regression amount is per-stat and
earned by the measured predictive power, not a uniform shrink (which over-compressed the good stats) or a floor.

## ★★★ FINAL LOCKED SPEC (2026-08-25) — all data-driven, no floors/dials ★★★
Refined after testing: a uniform stiff qualifier (IP≥80) fixes HR9 but BREAKS the others (calibrates on an elite-only
subpop → ERA/BB9 overshoot). The right split:
1. **Qualifier: IP≥40 / PA≥100** (Trevor confirmed).
2. **Two-sided (split) SD** on the qualified pop for EVERY stat — `sd_good` (deviations better than the mean) projecting toward
   elite, `sd_bad` toward poor. Fixes the skew + impossible values; lands ERA/WHIP/BB9/K9/AVG/ISO elite on reality.
3. **Sample-size shrinkage on HR9 ONLY** — HR9 is the sole **luck-dominated** stat (luck SD 0.42 > talent SD 0.37 at IP≥40;
   every other stat is talent-dominated, so the two-sided SD alone handles them — leave them untouched). Per-pitcher:
   `regressed = league_mean + (observed − league_mean) × IP/(IP+K)`.
4. **K is DATA-DERIVED** (variance decomposition, NOT eyeballed): a rate's luck variance scales as `C/IP` (Poisson events,
   `C = 9·mean` for per-9 rates, `= mean` for WHIP); `talent_var = observed_var − mean_luck_var`; **`K = C / talent_var`**.
   HR9 K = **71** this season (reliability 0.36 at 40 IP). Derived K per stat: HR9 71 · K9 25 · WHIP 26 · BB9 22 · ERA 18 —
   HR9's is far the largest, quantifying why only it needs shrinkage. The edge fn re-derives K each season.
   → HR9 elite projects **0.66** (= top-rated arms' actual mean 0.78 / Trevor's ~0.84 comfort). No floor, no dial.
5. **Pipeline: stage 5.5** — compute means + two-sided SDs + HR9's K on the qualified pop → store in `model_config` (read by
   returner/transfer/edge fn) → stage 6 projections consume → run the whole chain front-to-end + re-verify across the range.

**Superseded idea:** the earlier "per-stat regression by predictive power r" — replaced by the two-sided SD (handles the
well-ranked stats with no regression) + HR9-only sample-size shrinkage (handles the one luck-dominated stat). Re-weighting the
HR9 composite is a DEAD END (ceiling 0.335) — do NOT pursue it as the fix.

## RELATED
`project_pitcher_damping_path_b` · `feedback_pause_and_confirm_before_changes` (this was a long collaborative modeling session — propose + prove with data, don't set rules) · `project_power_rating_refits_2026_08_11` (the HR9 composite refit that exposed this).
