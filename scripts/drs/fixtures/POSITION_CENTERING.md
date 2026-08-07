# Per-position centering — the uniform rule (and why the floor is allowed to tilt)

Every component entering dWAR is centered **per position**, not just league-wide. This was learned
the hard way: four components in a row (grounder-range pool skim, seam transfer, error-engagement
blend, DP baseline dilution) all had the same shape — the league sum was zero the entire time a
per-position bias existed. That means **the league sum is the wrong grain for the tripwire.** The
disease is a class, so it's fixed as a class.

## The rule

At `run()` finalization, after each component's own logic:
- **dp** — per-**position** conversion rate (not league). A league rate is diluted by corner
  infielders who turn few DPs, over-crediting SS/2B as a class. That excess is mispriced
  **positional scarcity** (turning two is a middle-IF job), not skill — routed OUT of dWAR to the
  market layer, where scarcity lives. A good DP turner beats the average SS; an average SS nets 0.
- **range (air residual), arm, bunt** — de-meaned per position by fielding exposure (`bip_opps`).
  range_gb stays calibrated; this only removes the residual. The de-mean is a constant per-chance
  shift, so per-chance spread ordering (3B widest) is preserved.
- **errors** — per position × trajectory (see ERROR_CENTERING.md).
- **framing** — **EXEMPT.** Its ~+970 is a venue-calibration bias (parks miscalibrate probSL) with
  its own scheduled source fix (subtract each catcher's venue residual), not a position-mix effect.

Result: raw `drs_total` sums to **exactly 0 at every position**; the telescope closes to framing
alone. `check_position_grain.py` asserts this per-position and belongs in the regression suite —
it is the tripwire at the **right grain** so this disease class cannot reappear silently.

## Why the regressed floor mean is NOT forced to zero (the +0.23 SS tilt)

After centering, the **raw** ledger is exactly zero per position, but the **regressed** `drs_floor`
mean is mildly positive at high-variance positions (SS +0.23, 1B +0.03; it scales with position
variance). This is **correct estimator behavior, documented, not a bug:**

- The tilt is the shrinkage weight correlating with talent. Good shortstops play more (positive-raw
  SS average ~99 chances vs ~63 for negative-raw), so their estimates shrink less and retain their
  positive observed value; weak-glove/low-sample SS regress to ~0. Coaches bench bad gloves — that
  correlation is **real information**, not an accounting leak.
- **Do NOT de-mean the floor to force the mean to zero.** The floor is a per-player credibility
  estimate, and **a population of individually-honest estimates has no requirement to average to
  zero.** De-meaning would subtract the selection artifact from *every* shortstop — including the
  40-chance backup whose floor is already correctly near zero — biasing individual estimates to make
  their average cosmetic. That trades per-player honesty for a population property nobody consumes.
- **The raw ledger is where zero-sum lives; the floor is where per-player honesty lives. They are
  allowed to disagree by exactly this mechanism.**
