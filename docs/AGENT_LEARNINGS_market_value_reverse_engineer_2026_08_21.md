# MARKET VALUE — reverse-engineering the Program Tier Multiplier (2026-08-21)

Trevor's directive: recalibrate market value by REVERSE-ENGINEERING the PTM from real roster-spend
knowledge, not the coach-claimed "$40k/win." Keep the base `$25,000/WAR`; PTM carries the conference
spend differences. Biggest change: **SEC PTM must go UP** (1.5 is far too low).

## Current equation (unchanged base)
- **Hitter:** `market = total_hitter_war × $25,000 × PTM × PVM` (floored $0)
- **Pitcher:** `market = p_war × $25,000 × PTM` (no PVM)
- **PTM today:** SEC 1.5 · ACC/Big12 1.2 · BigTen 1.0 · strongMid 0.8 · low-major 0.5 · JUCO 0.35
- **PVM (hitter):** C/SS/CF 1.3 · 2B/3B/corner-OF 1.1 · 1B/DH/UT 1.0 · bench 0.8

## The problem Trevor identified
- SEC coaches claim **$40k/win**. Current SEC effective $/WAR = `$25k × 1.5 = $37.5k` ≈ the claim. So the
  model matches the CLAIM.
- But $40k/win flat is not how it works: $40k on the AVERAGE SEC player is wrong; $40k×(max 6.68 WAR) is
  closer to fair for the top guy. And critically — **the top of the SEC spends ~$5M on top-end rosters**,
  which does NOT come out to $40k/win. → the effective top-end $/win is much higher than $40k.

## Reverse-engineering method
`market_roster_total = $25,000 × PTM × Σ(WAR_i × PVM_i)` over the roster. Approximating `Σ(WAR×PVM) ≈ roster_total_WAR`
(avg PVM ≈ 1.05; refine with Σ of POSITIVE projected WAR × PVM later):
> **PTM_conf = target_top_spend / ($25,000 × top_roster_WAR_conf)**

## WAR reference data (staging, TODAY'S run 2026-08-21 — 96.6% fresh, post faced-competition + stored HTP)
**Per-conference TOP roster total WAR** (`team_season_stats.total_war_total`, descriptive 2026, NET):
| Conf | TOP | 2nd | 3rd | median | top team |
|---|---|---|---|---|---|
| SEC | **44.2** | 37.5 | 36.4 | 27.6 | Georgia |
| ACC | **46.1** | 38.0 | 30.1 | 23.6 | Georgia Tech |
| Big 12 | **32.9** | 32.0 | 28.3 | 20.3 | West Virginia |
| Big Ten | **36.2** | 31.9 | 30.8 | 19.1 | UCLA |
| Sun Belt | 29.7 | 28.0 | 22.6 | 20.5 | Southern Miss |
| Big West | 25.5 | 25.4 | 17.6 | 15.3 | UCSB |
| Mountain West | 22.0 | 20.0 | 19.6 | 16.7 | San Diego St |

**Starter WAR percentiles** (per-team projection pool):
- Hitter starters (cornerstone+everyday, n≈51k): total_hitter_war p50 0.96, p90 1.74, p95 2.01, p99 2.75, max 6.86.
- Pitcher starters (weekend+weekday+swing, n≈21k): p_war p50 0.81, p90 2.43, p95 2.78, max 4.13.
- Weekend aces (n≈6.4k): p_war p50 2.03, p90 2.98, max 4.13.

## Trevor's target spends (top-end roster per tier)
- **SEC: $3M–$5M** (top-end). ACC/Big12: **~$1M**. Big Ten: **~$750k**. Work DOWN from there for the rest.

## First-pass reverse-engineered PTMs (PENDING Trevor's confirmation)
Using each conference's TOP roster WAR + target spend:
| Conf | top WAR | target | eff $/win | **PTM** | (current) |
|---|---|---|---|---|---|
| SEC | 44.2 | $4M (mid) | $90.5k | **~3.6** (2.7 @ $3M → 4.5 @ $5M) | 1.5 |
| ACC | 46.1 | $1M | $21.7k | **~0.87** | 1.2 |
| Big 12 | 32.9 | $1M | $30.4k | **~1.22** | 1.2 |
| Big Ten | 36.2 | $750k | $20.7k | **~0.83** | 1.0 |

## OPEN MODELING CHOICES (need Trevor)
1. **SEC target** — $3M / $4M / $5M? (sets PTM 2.7 / 3.6 / 4.5.)
2. **Own-WAR vs common-reference anchor.** Anchoring each conf to ITS OWN top-roster WAR makes equal-$
   conferences get DIFFERENT PTMs (ACC 0.87 < Big12 1.22 because ACC's top team has more WAR). Alternative:
   anchor all to a common reference roster WAR (~40) so PTM is directly proportional to target $. Which?
   ⚠ Note the raw own-WAR result gives ACC (0.87) + BigTen (0.83) LOWER than today — because their top
   teams are talent-rich but (per Trevor) spend far less than SEC. That's internally consistent with the
   $ ratios ($1M/$5M = 0.2 → SEC 4.5 × 0.2 ≈ 0.9) but inverts the current tier order — confirm intended.
3. **Net vs positive-WAR roster sum.** total_war_total is NET (includes negative contributors); market floors
   negatives at $0, so Σ(positive WAR × PVM) for the paid roster is HIGHER → would LOWER the required PTM.
   Refine by summing the actual top roster's positive projected WAR before locking numbers.
4. **Base $/WAR** stays $25k (PTM carries the spread) — confirm.
5. **Curve shape** — still linear per-player. Decide separately whether elite players also need a convex
   premium ON TOP of the tier multiplier (the WAR tail is thin: starter p50 ~1.0, max ~6.9).

## Status
Framework + data captured. NEXT: Trevor confirms target spends + anchor method (#1/#2) → refine with
positive-WAR roster sums (#3) → propose final PTM table → apply (store in model_config + code) → re-run market.
Do NOT change the equation until Trevor sets #1–#5.
