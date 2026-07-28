# Team Builder — Snapshot as Single Source of Truth (Option B)

Status: **SPEC — awaiting confirmation.** Nothing implemented.

## The principle
The **active build's `player_snapshot`** is the single source of truth for every
displayed value, everywhere (Team Builder, Player/Pitcher Profile, GM roster).
The snapshot holds the **currently displayed** numbers — neutral when no toggle
is set, toggle-adjusted when one is. Reads are a **direct snapshot lookup with
no live compute**. Compute happens **once, on a toggle change**, and the result
is written back to the snapshot.

This kills, in one move:
- the **load flicker** (reads are synchronous; nothing async to race), and
- the **cross-surface mismatches** (Kenny's in-between value; profile ≠ TB),
because every surface reads the same stored number.

## Data model — where values live
| store | holds | mutable? |
|---|---|---|
| `player_predictions` (precompute/global) | neutral projections per (player, team, season) | **never** by TB |
| **default build** (`is_default`) `player_snapshot` | neutral base line | **never** — editing a default forces a new saved build |
| **saved build** `player_snapshot` | **the currently displayed values** (neutral or adjusted) | yes, on toggle change |
| **saved build** `production_notes` | the toggle **state** (depth role, dev-agg, position/role) for the UI + to know if non-default | yes, on toggle change |

The **neutral base is always recoverable** from the default build / predictions —
so "reset toggles" recomputes from there, and we never lose the true line.

TWPs: two rows (OF hitter + SP pitcher), each with its own snapshot values and
its own toggle state. Sides are computed independently; NIL is the sum.

## The invariant (the whole design in one line)
`snapshot === projectEffective(neutral base, production_notes)`
- **production_notes** = the toggle state (dev-agg, depth, position, SP/RP) — *the recipe*.
- **neutral base** = default-build snapshot / prediction row — *the ingredients*.
- **snapshot** = the displayed adjusted values — *the baked result*.

The recipe (production_notes) drives BOTH the knob positions in the UI and the
guard's recompute — so the knobs and the verification can never read different
state. On drift, **production_notes wins** (coach intent); the snapshot heals to it.

## Read path (display = pure snapshot read, NO overlay anywhere)
Today: `snapshot (neutral) → apply production_notes overlay (LIVE compute) → display`.
**New:** `snapshot → display`. The overlay is **removed** from every read path —
TB `playerProjection`, `effectiveHitterWar`/`effectivePitcherWar`,
PitcherProfile/PlayerProfile. This is what makes rendering **idempotent**: reading
the same snapshot N times shows the same number N times, so nothing can compound.
Killing the overlay is the single fix that closes both the flicker AND the
double-dev-agg bug — they were the same overlay.

(Standalone scouting "what-if" preview — a page not tied to a build — stays a
session-only sandbox that computes from the neutral prediction. Not snapshot+overlay.)

## Write path (compute once, on toggle change — optimistic)
When a coach changes a toggle:
1. Read the **neutral base** for that player+side — NOT the current adjusted
   snapshot, so changes never compound (idempotent: dev-agg 0.5 always means
   "0.5 vs neutral," never "0.5 on top of whatever's there").
2. Recompute the adjusted line from neutral + the **full new toggle state**
   (canonical fns below). This runs **once, in the click handler** — not on render.
3. **Immediately** update local snapshot state → instant display (0ms, same feel
   as today).
4. **Background** one-way write of snapshot + production_notes to the DB. NO
   refetch-that-recomputes — state → DB only, so there's no write→recompute loop.
5. Reset-to-default = recompute with neutral toggles → writes the neutral line back.

"Edit a default roster" first **forks to a new saved build**, so the default
snapshot never mutates.

## Load path + the self-healing guard
On open, three reads reconcile:
| Read | Source | Role |
|---|---|---|
| Knob positions | production_notes | what the coach set (already wired via build-player meta) |
| Displayed numbers | snapshot | the cached result — shown **instantly**, no wait |
| Guard | `projectEffective(neutral, production_notes)` | proves numbers == knobs; heals to knobs on real drift |

The guard runs in the background and only heals a **genuine** mismatch. Two rules
keep it from misfiring (which would re-create the flicker):
- **Wait for complete data** — only compare once all async deps are loaded; never
  heal off partial-data compute.
- **Compare at display precision, with tolerance** — pRV+/wRC+ are rounded, so
  compare the rounded/displayed values; float noise must not trigger a heal.

In steady state the guard always matches → invisible. It only fires after a
formula change or a half-failed write, and when it does it's a *correction*. This
is the runtime version of the dev-agent's stored-vs-live consistency guard.

---

## THE CALCULATIONS (confirm these)

All constants below are the shipped defaults; the `pwar_*` / `market_*` ones are
overridable via `model_config` (none currently overridden).

### Toggle inputs
- **dev aggressiveness** (`devAgg`, session) scales the **rate** (wRC+ / pRV+),
  never WAR directly, never PA/IP.
  `devScale = (1 + classAdj + sessionDevAgg×0.06) / (1 + classAdj + 0×0.06)`
  (stored dev on the neutral snapshot is 0).
  `classAdj` hitter: FS 0.03 / SJ(&default) 0.02 / GR 0.01.
  `classAdj` pitcher: FS 0.03 / SJ(&default) 0.02 / JS 0.015 / GR 0.01.
- **depth role** sets **PA** (hitter) / **IP** (pitcher).
  Hitter PA: cornerstone 245 · everyday_starter 215 · platoon_starter 145 · utility 85 · bench 25.
  Pitcher IP: weekend_starter 85 · weekday_starter 50 · swing_starter 30 · workhorse_reliever 50 · high_leverage_reliever 33 · mid_leverage_reliever 20 · low_impact_reliever 12 · specialist_reliever 6 · (RP default 35).
- **position change** changes the **positional multiplier** (hitter market) — WAR is unchanged.
- **SP↔RP role change** applies the **role-transition regression** to pitcher rates (→ pRV+) AND changes **PVF** (pitcher market). WAR moves via pRV+; PVF is market-only.

### Hitter oWAR  — `computeOWar` / `computeOWarFromWrcPlus`
```
wRC+_adj = round( wRC+_neutral × devScale )
PA       = paForHitterDepthRole(sessionDepthRole)
oWAR     = [ ((wRC+_adj − 100)/100) × PA × 0.13  +  (PA/600) × 25 ] / 10
```
- Positional value is **NOT** in oWAR (market only).
- Baseline (devScale=1, stored depth): reproduces stored `o_war` exactly.

### Hitter rates (displayed slash + wRC+)
```
avg_adj = avg × devScale ; obp_adj = obp × devScale ; iso_adj = iso × devScale
slg_adj = avg_adj + iso_adj ; ops_adj = obp_adj + slg_adj
wRC+_adj = round( (wObp·obp_adj + wSlg·slg_adj + wAvg·avg_adj + wIso·iso_adj) / ncaaAvgWrc × 100 )
```
(dev scales the slash rates → wRC+ scales with them; identical to the precompute.)

### Pitcher pWAR  — `computePitcherWar` / `effectivePitcherWar`
```
Step 1 (dev): each rate × devScale — INVERSE for low-better (ERA/FIP/WHIP/BB9/HR9),
              DIRECT for K9; pRV+ × devScale.
Step 2 (role, only if SP/RP bucket changes vs stored): apply role-transition
              regression (rp_to_sp tiered curve / sp_to_rp_*_pct) to the
              dev-adjusted rates, then re-derive pRV+ from the six +stats:
   pRV+_adj = Σ ( plus_i × weight_i )   over era/fip/whip/k9/bb9/hr9
Step 3 (WAR): IP = pitcherIpForDepthRole(sessionDepthRole)
   pWAR = [ ((pRV+_adj − 100)/100) × (IP/9) × 7.11  +  (IP/9) × 1.5 ] / 10
```
- `pwar_r_per_9 = 7.11`, `pwar_replacement_runs_per_9 = 1.5`, `pwar_runs_per_win = 10`.
- **NO PVF in pWAR.** Baseline reproduces stored `p_war` exactly.

### Hitter market  — `computeHitterMarketValue`
```
market = oWAR × 25000 × programTierMultiplier(conference) × positionValueMultiplier(position)
positionValueMultiplier: C/SS/CF 1.3 · 2B/3B/IF/LF/RF/OF 1.1 · 1B/DH/UT 1.0 · bench 0.8
```

### Pitcher market  — `computePitcherMarketValue`
```
market = pWAR × 25000 × programTierMultiplier(conference)      (NO PVF)
```
- **PVF is dropped entirely for pitchers** — in WAR *and* market. The role's
  value (starter vs reliever) is already captured in WAR through **IP** (a
  starter's 85 innings vs a reliever's 35). Applying PVF anywhere double-counts
  that. Team Builder's pitcher market already omits PVF; the precompute
  `computePitcherMarketValue` still applies it and will converge when 2027
  projections rerun without it.

### TWP
- Hitter side: oWAR/market from the OF row's wRC+ + hitter depth (+ position mult).
- Pitcher side: pWAR/market from the SP row's pRV+ + pitcher depth (+ PVF).
- Stored per-side as `twp_hitter_market_value` / `twp_pitcher_market_value`.
- Displayed NIL = hitter market + pitcher market (single combined figure).

### The invariant to hold everywhere
For any surface and any toggle state, the displayed oWAR/pWAR must equal
`computeOWar(displayed wRC+, displayed PA)` / `computePitcherWar(displayed pRV+,
displayed IP)` — i.e., the row is **self-consistent**, and identical across TB,
Profile, and GM because they read the same stored snapshot.

---

## Rollout
1. Land the canonical calcs (hitter done; pitcher = PitcherProfile fix done,
   confirm TB pitcher + TWP pitcher).
2. Switch reads to direct snapshot (remove overlay compute).
3. Add write-on-toggle: recompute from neutral base → persist to snapshot.
4. Enforce "edit default → new build".
5. Re-snapshot builds (staging, then prod with the promotion) so every snapshot
   holds current values.

## Risks / open
- Every toggle handler must persist (depth, dev, position, role, per-side TWP) —
  miss one and that toggle silently doesn't update the display.
- The write must always recompute from the **neutral base**, never the current
  adjusted snapshot, or changes compound.
- Concurrency: two coaches on a shared build both writing snapshots (later).
