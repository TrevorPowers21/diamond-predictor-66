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
**Finding:** groundball is NOT the culprit (it's a real predictor). The mis-weight is **barrel under-weighted (best signal, smallest weight)** and **pull over-weighted (worst signal, big weight).** Re-weighting toward barrel + away from pull sharpens the rating (tightens the extreme ratings that over-reach). BUT HR9's inputs top out at ~0.27 corr — it's inherently the least-predictable stat, so it will always regress the most, *earned by the data* (not a floor). Composite re-weight is a candidate follow-on; still OPEN whether that alone suffices or HR9 also needs its weak signal reflected in the projection.

## RELATED
`project_pitcher_damping_path_b` · `feedback_pause_and_confirm_before_changes` (this was a long collaborative modeling session — propose + prove with data, don't set rules) · `project_power_rating_refits_2026_08_11` (the HR9 composite refit that exposed this).
