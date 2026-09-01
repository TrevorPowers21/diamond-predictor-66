# ▶️ HANDOFF — 2026-09-01. Config sources, calibration, snapshot read path. **START HERE.**

Branch `feature/war-recalibration` · PR #171 open against `staging` · all work below is **pushed**.
Companions: `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md` (gates) ·
`docs/AGENT_LEARNINGS_snapshot_read_path_2026_09_01.md` (the read-path doctrine).

---

## 🚨 THE ONE THING TO UNDERSTAND

**Three config systems are live at once, and the hitter path reads a different one on prod than on
staging.** Everything else in this file follows from that.

| path | reads | PROD | STAGING |
|---|---|---|---|
| Pitching — `readPitchingWeights` (`pitchingEquations.ts:147`) | `"Equation Weights"` @ **2025** | 0 of 40 mapped keys present → **code defaults** | table EMPTY → **code defaults** |
| Hitting — `predictionEngine.ts:261` | `"Equation Weights"` @ **2025** | **333 keys — LIVE, overrides code** | table EMPTY → **code defaults** |
| Pitcher power ratings — `loadPitchingPowerEq` (`predictionEngine.ts:694`) | `model_config` admin_ui @ **2026**, keys starting `p_` only | ✅ | ✅ |
| Batch precomputes + edge fn | `model_config` admin_ui @ **CURRENT_SEASON** | ✅ | ✅ |

⛔ `predictionEngine`'s "fall back to `model_config`" branch is **DEAD CODE** — it filters
`model_type IN ('returner','transfer')`, but `model_config` contains **only `admin_ui`** rows in both
databases. It has never returned a value.

---

## ✅ GATE B IS SOLVED — it was never a dev-scale or stale-copy problem

**Prod's returner wRC+ runs a DIFFERENT EQUATION than the code default, because a 2025 table overrides it.**

```
code default (predictionEngine.ts:120)   intercept .011  obp .691  slg .235  avg 0     iso 0    ÷ .3782
prod, overridden by Equation Weights     intercept .011  obp .450  slg .300  avg .15   iso .10  ÷ .364
```
Computed at `predictionEngine.ts:543`, which multiplies all four terms.

**PROOF — n = 5,122 D1 returner hitters:**
```
reproduces the STORED p_wrc_plus (±1.5):   Equation Weights formula 5,122 (100%)
                                            canonical formula        1,164  (23%)
```
That is why Naulivou Lauaki stored **113** where the canonical formula gives **100.5**. It also explains
the asymmetry in the original symptom (**returners 64% mismatched, transfers 19%**): the transfer path
has its own config block (`:428-456`) with its own defaults, so it was only partly affected.

**BLAST RADIUS of switching to canonical** — approved by Trevor ("AVG lowering is fine"):
```
mean −1.43 · median −1.5 · p05 −9.1 · p95 +6.5 · extremes −18.0 / +19.8
62% go down, 38% go up
```
A **redistribution, not a repricing**: the four-stat formula double-counts AVG, so contact hitters lose
and high-OBP walkers gain. wRC+ → oWAR → market are ~linear, so ≈1.5% median downstream.

---

## ✅ C1 SOLVED — ERA ran ~4% low. Two constants, one cause.

Both were **fit on one population and applied to another**, producing a CONSTANT offset — equal
discrepancies at every percentile and in every class bucket, with no per-class pattern.

**(1) The calibration producer had NO division filter.** At its own qualifier (Season 2026, `IP>=40`):
```
D1 1,295 (mean ERA 5.264) · NJCAA_D1 477 (6.118) · D2 1 · ALL 1,773 (5.492)
```
477 JUCO pitchers — 27% of the sample — inflated the **D1** anchor by **0.229 ERA (4.3%)**.
`git log` confirms the filter was **never present** (2 commits, no `division` line ever).

**(2) The z-shift subtracts a hardcoded `100`, but PR+ is not centered at 100 there.**
True D1/`IP>=40` centers: `era 109.7253 · fip 108.2875 · whip 108.4028 · k9 101.6919 · **bb9 123.1615** ·
hr9 102.0359 · overall 109.0064`. On the all-division/`IP>=20` population those same centers are
96.3–104.0 (≈100) — PR+ was FIT there and APPLIED here. ERA carried **+0.44 of phantom improvement**.

**VERIFIED** (real constants; a constant offset, spread preserved):
```
AVERAGE pitcher (PR+ 109.7253)  4.9280 → 5.2757    (actual 2026 mean 5.3040)
ELITE (PR+ 140)  3.8457 → 4.1934      WEAK (PR+ 80)  6.2359 → 6.7028
```

★ **HITTING IS NOT CONTAMINATED THIS WAY.** Its anchors were already D1-scoped (2026-08-11 refits, not
this script) and its centers sit at 100.31–103.79. Centers are stored for both sides anyway.

---

## 📋 WHAT IS DONE (code) vs NOT DONE (data)

### ✅ Shipped and verified by Trevor on staging
| fix | evidence |
|---|---|
| Snapshot read path unified across 4 surfaces (`useActiveBuildSnapshot`) | Flores, Cespedes, Paz, Luke Howe 4.86, Neiswonger |
| Hitter toggle WAR persists (`total_hitter_war` written on BOTH save paths) | Farner, holds through Save + reload |
| Target board reads its own line (select by VALUE, not `position_slot`) | Neiswonger; `position_slot` NULL on 93–96% of rows |
| GM hub reads the snapshot (was an additive dev approximation → 4.84 vs 4.86) | Luke Howe consistent across all 3 surfaces |
| Top 5 un-blanked (reverted my `team_id` ghost filter) | staging `team_id` NULL on 15,560/15,561 |
| 146 stale D1 projections deleted (prod + staging), Wiggins protected | both DBs now 0 stale rows |

### ⬜ NOT DONE — code is fixed, DATA IS NOT
1. **`model_config` never written** on either DB — the calibration producer has only been dry-run.
2. **Nothing reads `pr_center` / `pr_sd` from any table.** The producer emits `era_plus_pr_center`;
   `readPitchingWeights`'s 40-key mapping has no such entry, and `loadPitchingPowerEq` only takes keys
   starting `p_`. **The calibration work is INERT until a reader is wired.**
3. **Edge function** keeps its own constant copies AND its own hardcoded `100` — onboarding still
   projects with the old bias.
4. **Precomputes not re-run** — every stored `p_era`/`p_war`/`p_wrc_plus`/`market_value` on prod still
   carries both biases.

---

## ▶️ NEXT STEPS, IN ORDER (all approved by Trevor 2026-09-01)

**1. Mark legacy clearly.** Rename `"Equation Weights"` → `"Equation Weights_LEGACY_2025"`.
   ⚠ Rename, do **not** delete — a rename makes a missed reader crash LOUDLY instead of silently
   falling back to code defaults, which is the exact failure mode chased all day.
   Effect: prod's hitter wRC+ reverts to the canonical formula. Staging unaffected (already empty).

**2. Delete the override block** `predictionEngine.ts:379-405` and the dead `model_config`
   returner/transfer fallback, so nothing can silently re-override the defaults.

**3. Wire the readers to `model_config` admin_ui @ 2026** (the single source of truth) and add
   `pr_center` / `pr_sd` to a mapping. Decide the key convention first — `loadPitchingPowerEq` uses a
   `p_` prefix (`p_era_pr_sd` already exists in model_config) while the producer emits
   `era_plus_pr_center`. **Pick ONE and make the producer match it.**

**4. Apply the calibration** — `npx tsx --env-file=<env> scripts/compute-projection-calibration.ts`
   (dry-run first; expect **41 keys**, and `⚠ far from 100` on the 5 pitching centers). Staging → prod.

**5. Mirror everything into the edge function** (constants + the hardcoded 100).

**6. Re-run precomputes**, then verify the **ACROSS-THE-RANGE** table — p05/p10/median/p90 — not the
   mean. A constant offset is invisible to a mean check.

---

## ⛔ TRAPS — each of these already cost time today

- **Verify every filter on BOTH databases.** A display filter that was a perfect no-op on prod emptied
  the Top 5 on staging (`team_id` NULL: prod 50%, staging 99.99%). Local reads staging; the Vercel
  preview reads PROD.
- **Test the VALUE, not the key.** `transfer_snapshot ? 'p_era'` said 122/169 rows had "both" sides;
  by value it is **0** — the keys exist carrying NULLs.
- **A unique name match is not the same person.** All 6 proposed `player_id` relinks were wrong people
  (4 stale stubs, 2 real D2 players). The orphans are FRESHMEN (`classTransition "FS"`) with no
  `players` row because they have no stats yet. **Do not relink** — see the closed section in the PLAN.
- **Enumerate every writer before declaring a persistence bug fixed.** The toggle-WAR bug had TWO save
  paths; fixing one made it look solved until Trevor pressed Save.
- **A value-difference test is not a user-intent test** — hence `userToggled` in PitcherProfile.
- **A range check cannot catch a constant offset.** The 08-24 doctrine mandates across-the-range
  verification, and it would have passed this ERA bug: a miscentered rating shifts the LEVEL and keeps
  the SHAPE. The tell was EQUAL discrepancies everywhere.

---

## 🔑 KEY IDs / NUMBERS

```
Georgia Bulldogs   staging 3b1cc0e2-4acd-4a27-a7bc-d345c347f18d   prod 9aef3923-0f11-4813-8036-5766b0db64b6
Arkansas           6deca66a-b4c0-403f-9614-a9d32f1d5994 (both)
Carson Wiggins (redshirt, PROTECT)  31d52121-0522-451a-b6dd-a1f2a8e7b9b0
model_config prod: admin_ui 2025:140 · 2026:220   |  staging: 2025:157 · 2026:220
"Equation Weights": prod 2025:361 rows · staging EMPTY
prod era_plus_ncaa_avg = 5.483215 (all-division) → should be ~5.2635 (D1)
```

## ⬜ OPEN, NOT STARTED
- Small-sample pRV+ (D1 119 rows ≤10 IP with pRV+ ≥120; JUCO 53 = separate FIP bug, parked)
- 8 unnamed roster slots; `included_in_roster` vs the budget-share floor untraced
- Other 5 `target_board` call sites — confirm explicit `customer_team_id` scoping
- Market-value path unverified (Trevor suspects overridden legacy logic)
- Onboarding verification + Georgia Tech — **blocked until the above lands**
