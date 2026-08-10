# WAR Changelog — visible reasons for every number move

Coaches see WAR on staging/prod. Every time a number moves, it gets a dated line here, and the
coach-facing note (WhatsNewModal) is posted when the change actually reaches prod. Trust erodes the
second time numbers move without a posted reason.

---

## 2026-08-10 — Hitter oWAR conversion corrected (staging; not yet on prod)
**What moves:** hitter offensive WAR (oWAR), and anything priced off it (rankings, NIL/market value,
team totals). Star hitters up, below-average hitters down, league-average unchanged. Pitcher WAR
unaffected by this item.

**Why:** the constant converting wRC+ to runs was wrong. It had been set to the league's average
runs-per-PA (0.163); the correct value is the run-value of a wOBA point (lgwOBA/wOBAscale = 0.3994).
The old value systematically under-counted hitters and compressed the top. The fix is a pure slope
correction: it pivots around the league-average hitter (which is why average players don't move) and
lets each hitter land on his true value — the projected number now reproduces descriptive at 0.04 WAR.

**Magnitude (real players):** Helfrick 1.46 → 2.19 (matches his actual production); Hairston (best bat
in the country) → 5.28. Good-but-normal hitters move ~+0.7; only elite outliers move a lot, because
they were the ones most compressed.

**Not egregious because:** top position-player totals (~5–6.6) are bat + premium-position defense +
baserunning, not a runaway offensive number; the pitcher and hitter value spreads match (WAR SD 0.94
vs 0.95, both peaking ~4.8σ), so a win is a win across both sides.

**Cross-system consistency check that passed:** Helfrick's dWAR here (2.49) matches the defensive
board's park-free floor (+33.5 runs ÷ 13.1 = 2.56) within rounding — two separate pipelines, same number.

**Status:** on staging, verified in-DB. Reaches prod at Step 8 (prod replay) — post the WhatsNewModal
note then.

---

## (earlier) 2026-08-07 — D1 scale reconcile (RPW 10 → 13.1, D1 run environment)
Moved all WAR onto the D1 run environment. NOTE: this pass introduced the wrong 0.163 oWAR conversion
constant (corrected 2026-08-10 above).
