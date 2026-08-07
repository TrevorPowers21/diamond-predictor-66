# RSTR IQ dWAR Conversion and Defensive Projection Layers
## Spec Addendum v1.0 (extends Defensive Runs Engine Spec Section 12)

**Status:** Design locked (2026-08-03, Trevor). **Build BLOCKED on full-season import.**
**Supersedes** the main spec's §12 "re-derived or MLB-scaled positional adjustment" note —
positional adjustment is now the empirical per-position centering derived from our own data;
the MLB ladder is explicitly NOT imported (see §1).

### Status / codebase reality (2026-08-03)
- The dRS engine this builds on is **done + reconciled** (`scripts/drs/`, v0.2.0, 26/26 tests,
  `player_season_defense` schema in `docs/DEFENSIVE_RUNS_ENGINE_SPEC.md` §9). This addendum is the
  layer ABOVE it.
- **Nothing here can be built until the full-season TruMedia export lands** — the whole dependency
  chain (§8) starts with the D1 RE24 matrix + constants derivation (which flips
  `constants_version` off `PLACEHOLDER_MLB_v0` and `fixture_quality` to `FULL`). Steps 1–3 are pure
  engine runs on real data; steps 4–7 are the new build surface this addendum specifies.
- **Integration note for the combiner (§2):** our offensive WAR lives in `src/savant/lib/war.ts`
  (`computeOWar` / oWAR formula, mirrored in `CLAUDE.md`). Before building the total-WAR combiner,
  determine whether oWAR already bakes in a replacement treatment — the double-counting guardrail
  depends on applying replacement exactly once across the two sides.

---

## 1. Core Model (Locked)

dRS is accumulated runs saved over playing time, priced per play. Every play made carries a
runs-saved value of (1 - xOut) x RUNS_PER_PLAY: near zero for routine plays, approaching a full
play value for excellent plays. Debits accrue symmetrically on hits through responsibility, and
errors accrue at max punishment. The season total is a raw accumulation, **NOT assumed to be
centered at zero**.

**Average is learned, not assumed.** Theoretical self-centering only holds if xAVG is perfectly
calibrated. It is not (three-game validation showed league net range of +6.55 — cf. the +2.91 on
the 2-file reconciliation set; the point stands: nonzero). Each position's actual average accrual
rate is measured empirically from the full-season distribution, **per position**, because each
position accrues dRS through a different mix of channels (SS through range and DP turns, 1B
through a narrow easy-chance set, C through framing volume no other position has).

**Positional adjustment is replaced by empirical positional scales.** Do NOT import or scale the
MLB positional adjustment ladder (+7.5 SS etc.). The per-position empirical centering IS the
positional adjustment, derived from our own data.

**Replacement level is learned per position from the depth tier.** Replacement rate at a position
= observed dRS accrual rate of depth/bench-tier players at that position in the retroactive season
(the players who absorb innings when starters sit). Measured, not assumed.

dWAR formula:
```
rate_p        = player dRS per opportunity (internally) at position p
repl_rate_p   = depth-tier accrual rate at position p (empirical)
dWAR          = (rate_p - repl_rate_p) x defensive_innings_equiv / RUNS_PER_WIN_D1
```
RUNS_PER_WIN_D1 derived from the D1 run environment (~2 x league runs per game per team), never 10.

A +25 dRS accumulation does NOT mean 25 wins. dWAR is impact over replacement at the position,
scaled through the empirical machinery above.

## 2. Double Counting Guardrail (Locked, Critical)

Because dWAR here is built above positional replacement, the total WAR combining layer must apply
any replacement deduction exactly ONCE. If oWAR carries its own replacement treatment, the
combiner must not subtract replacement again on the defensive side (and vice versa). Write this as
an explicit assertion in the combining layer: total WAR = oWAR components + dWAR components with a
single replacement application, verified by a **unit test that constructs a league-average player
and confirms his total WAR equals the replacement gap exactly once**.

## 3. Rate Construction (Locked)

- Internal rate denominator is **responsibility opportunities, not innings**. Innings are the
  projection-time volume unit; opportunities are the skill-rate unit. Decontaminates rates from
  staff GB/FB profile.
- Conversion to per-inning uses the (projected) team BIP profile, which matters most for transfers
  changing staffs and parks.
- Projections use the **regressed rate (floor)**, with raw (ceiling) shown as upside. Never project
  off raw.

## 4. Retroactive Season (Locked)

Run the full engine on the prior season's exports with that season's OWN fixtures (own RE24 matrix,
own league rates, own constants stamp). Cross-season comparability comes from each season being
measured against its own league. The retroactive season supplies:
1. The dRS distribution per position (what elite means, what a top defensive team's sum looks like)
2. Empirical positional averages
3. Empirical replacement rates from the depth tier
4. Innings distributions for bucket anchors
5. Projection input rates for returning players

## 5. Roster Buckets and Defensive Innings (Locked)

Buckets are shared with the hitter side: cornerstone, everyday starter, platoon, depth, bench.
**ONE tag per player drives BOTH offensive PA projection and defensive innings projection.** The
two sides must read the same tag and can never disagree.

Innings anchors are empirical and per position, from the retroactive season:
- cornerstone: ~90th percentile of defensive innings at the position
- everyday starter: median of qualified starters at the position
- platoon: ~55 to 65 percent of everyday (handedness driven)
- depth / bench: observed remainder tiers

Catcher anchors will differ structurally from infield/outfield anchors. Never share one innings
number across positions.

## 6. No-History Players (Locked v1, roadmap v2)

- **v1:** freshmen and JUCO transfers project at a position-average rate prior, regressed hard,
  displayed with a wide floor/ceiling so uncertainty is visible.
- **v2** (once two seasons exist): cohort priors — measure what past JUCO transfers and freshmen
  actually produced defensively in their first D1 season per position; use the cohort mean as the
  prior, split further by profile if sample supports.
- **Product layer:** coach can override the prior in the GM workflow (Everyday GM division of labor:
  system supplies the honest default, staff supplies the scouting, projection shows both).

## 7. Position Switches (Locked v1)

Projecting a player at a new position: swap to the new position's empirical scale and replacement
line, regress the carried rate harder than a same-position projection, disclose the switch in the
UI. Rates do not port cleanly across positions; v1 does not pretend they do.

## 8. Dependency Order After Full-Season Import

1. Season RE24 matrix and derived constants (replaces PLACEHOLDER_MLB_v0, fixture_quality flips to FULL)
2. Current season dRS
3. Retroactive season dRS on its own fixtures
4. Empirical positional averages and replacement rates; distribution benchmarks
5. RUNS_PER_WIN_D1; dWAR conversion
6. Bucket innings anchors per position
7. Projection layer: regressed rate x projected innings via shared bucket tags
8. Anchor validation against trusted defenders (same protocol as bat speed anchors) before anything ships

Each step consumes only the one before it. Steps 1 through 3 are pure engine runs; 4 through 7 are
the new build surface this addendum specifies.

## 9. Output Schema Additions

Table: `position_defense_scales` (grain: season x position)
```
season, position, avg_rate, repl_rate, rate_sd,
innings_p90, innings_median_starters, innings_platoon, innings_depth,
runs_per_win, fixtures_version, computed_at
```

Table: `player_season_dwar` (grain: player x season x position, reads player_season_defense + position_defense_scales)
```
player_id, season, org_id, position,
rate_raw, rate_regressed, opportunities, innings_equiv,
dwar, dwar_floor, dwar_ceiling,
bucket_tag, projected_innings, projected_dwar,
scales_version, engine_version, computed_at
```

No changes to `player_season_defense` required.
