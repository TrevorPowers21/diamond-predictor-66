# Error centering — the engagement denominator (auditable definition)

`error_runs` is centered like every other dRS component: **vs the average fielder, not vs perfect.**
Errors used to be a raw charge with no offset ("vs a fielder who never errs"), so the league bled
~9,500 phantom runs and every average defender started negative. Now:

```
error_runs(fielder) = expected_error_cost − actual_error_cost
expected_error_cost = Σ_traj  rate[group, traj] × engagements[fielder, traj]
rate[group, traj]   = Σ actual error cost in the cell / Σ engagements in the cell
```

Punishment per error is **unchanged** — the full 0.964 (sure-out-became-a-single) + advancement is
accrued as `actual_error_cost`. Centering only supplies the credit side that was missing: every
clean chance you handle earns the sliver of expected-error cost the average fielder eats on it. A
sure-handed shortstop finally reads **+ hands** instead of merely less-negative.

## Engagement (the denominator) — DEFINITION

An **engagement** is one ball the fielder **reached**. Precisely:

> **Engagement = out-chain membership on a batted ball, OR an E charge on a batted ball.**

- **Out-chain membership**: the fielder appears in any putout/assist chain on a batted-ball out
  (`_engage_out_chains`), so the fielder who fielded it, every relay man, and the putout man each
  get one engagement (each had a distinct chance to boot/drop/throw-away). Deduped per ball.
- **E charge**: a fielder charged an error is engaged (`_error_debit`), unless already engaged via
  an out-chain on that same ball (no double-count). ROE (batter reached, no out) always engages here.

**Explicitly EXCLUDED** (the way A degrades quietly if you let it):
- **Deflections / tips** — a ball the pitcher deflected into a fielder's path that he had no play
  on. These are not putout-chain members and carry no E, so the retrosheet-style grammar excludes
  them automatically. Do NOT add "partial touch" crediting without revisiting this.
- **Balls that got through for a hit with no error** — not reached, not an engagement. (That's a
  *range* miss, priced in range_runs, not a *hands* event.)
- **Strikeout / baserunning throw chains** — not batted-ball fielding; their error exposure is arm,
  a separate component.

Hands is thus **conditioned on reach** — "of the balls you got to, did you finish them" — which is
orthogonal to range ("did you get to it"). That orthogonality is what keeps the **+6 range / −4
hands** card diagnostic meaningful; a zone denominator (balls-in-zone incl. hits) would launder bad
range into good hands and collapse the two into one.

## Cells

Rates are split by **(position-group × trajectory)**: group ∈ {IF, OF, C, P}, traj ∈ {gb, air};
an infielder's ground-boot rate never blends with an outfielder's. Cells below `MIN_ENG` (200
engagements) fall back to the trajectory-global rate (leaves a tiny residual on sparse cells like
OF-grounders, well within telescope noise). Rates are derived **fresh each run** from the season's
own data — no stale-fixture risk — and emitted to `error_rates.json` for audit.
