# ▶️ HANDOFF — 2026-09-01. Config sources, calibration, snapshot read path. **START HERE.**

Branch `feature/war-recalibration` · PR #171 open against `staging` · all work below is **pushed**.
Companions: `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md` (gates) ·
`docs/AGENT_LEARNINGS_snapshot_read_path_2026_09_01.md` (the read-path doctrine).

---

## 🚨 THE ONE THING TO UNDERSTAND

**Three config systems were live at once, and the hitter path read a different one on prod than on
staging.** That is now FIXED in code (steps 1–3) — but every stored number still carries the old bias
until the precomputes re-run (step 6).

### AS IT IS NOW (after steps 1–3)
| path | reads | state |
|---|---|---|
| Pitching — `readPitchingWeights` | **`model_config` admin_ui @ 2026** | ✅ repointed 2026-09-01 |
| Hitting — `predictionEngine.loadEngineConfig` | **code defaults + per-team overrides only** | ✅ legacy read removed |
| Pitcher power ratings — `loadPitchingPowerEq` | `model_config` admin_ui @ 2026, `p_` keys | ✅ unchanged |
| Batch precomputes + edge fn | `model_config` admin_ui @ CURRENT_SEASON | ✅ unchanged |
⇒ **`model_config` (admin_ui, season 2026) is now the single source of truth.**

### WHAT IT WAS (why anything was wrong at all) — keep for context
| path | read | PROD | STAGING |
|---|---|---|---|
| Pitching | `"Equation Weights"` @ 2025 | 0 of 40 mapped keys → code defaults | table EMPTY → code defaults |
| Hitting | `"Equation Weights"` @ 2025 | **333 keys — LIVE, overrode the code** | table EMPTY → code defaults |

⛔ `predictionEngine`'s "fall back to `model_config`" branch was **DEAD CODE** — it filtered
`model_type IN ('returner','transfer')` while `model_config` holds **only `admin_ui`** rows, so it never
returned a value. Removed in step 2.

★ **THE LESSON**: same code, two databases, different equations — because one had rows and the other did
not, and the override was guarded by `if (eqWeights.size > 0)`. **Verify config on BOTH databases.**

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

### ✅ STEPS 1–3 COMPLETE (config consolidation)
| step | what | state |
|---|---|---|
| **1** | `"Equation Weights"` → `"Equation Weights_LEGACY_2025"` | ✅ **BOTH databases.** Verified 4 ways: renamed · 361 rows intact · no dependent views/functions · **5,122 stored D1 returner hitters UNCHANGED, mean wRC+ 98.82** — which is the proof that nothing live-computes. |
| **2** | Retire the legacy source | ✅ `predictionEngine` no longer reads the 2025 table (that was Gate B). Dead `model_config` returner/transfer fallback removed — it filtered a `model_type` that does not exist, so it always returned nothing, and it had no season filter. `pitchingEquations` repointed to `model_config` admin_ui 2026. ⚠ The per-team override block was **KEPT** — it is the carrier for [[project_per_program_equation_overrides]], not legacy. |
| **3** | Key convention + wire the readers | ✅ `p_<stat>_pr_center` / `h_<stat>_pr_center` (matches the 54 existing `p_*` keys). **12 keys added to the `fields` mapping** in `pitchingEquations.ts`. This is what made the calibration stop being inert. |

### ⬜ STILL NOT DONE — CODE IS FIXED, **DATA IS NOT**
1. **`model_config` never written** on either DB. Producer dry-runs clean at **41 keys**.
2. **Edge function** keeps its own constant copies AND its own hardcoded `100` — onboarding still
   projects with the old bias.
3. **Precomputes not re-run.** Every stored `p_era` / `p_war` / `p_wrc_plus` / `market_value` on BOTH
   databases still carries BOTH biases. **No displayed number has changed yet.**
4. **Stage 5.5 autofill NOT BUILT** — it is a manual script; a Masters refresh silently invalidates
   every constant and nothing warns you.

## ▶️ RESUME HERE — STEP 4. (Steps 1–3 are done; do not redo them.)

**4. Apply the calibration — STAGING FIRST.**
```
npx tsx --env-file=.env.local              scripts/compute-projection-calibration.ts          # dry run
npx tsx --env-file=.env.local              scripts/compute-projection-calibration.ts --apply
npx tsx --env-file=.env.production.local   scripts/compute-projection-calibration.ts --apply  # after staging checks
```
Expect **41 keys** and `⚠ far from 100` on exactly 5 pitching centres (era/fip/whip/bb9/overall).
⚠ This REPLACES the 19 all-division keys with D1-only values. It moves **no stored projection** on its
own — projections change at step 6.
**Gate:** `era_plus_ncaa_avg` reads ~**5.2635** (was 5.483215) and `p_bb9_pr_center` ~**123.16** exists.

**5. Mirror into the edge function** (`supabase/functions/process-precompute-jobs/index.ts`) — its own
constant copies AND its own hardcoded `100`. Until then, onboarding a team writes old-bias projections
into a brand-new program. ⚠ It reads `model_config` already, so prefer DELETING its local constants
over updating them.

**6. Re-run the precomputes, then verify ACROSS THE RANGE.**
⚠ **THIS is where numbers move**: ERA up ~0.35 (constant offset, spread preserved), hitter wRC+
redistributing (median −1.5, 62% down / 38% up). Verify p05 / p10 / median / p90 — **a mean-only check
is blind to this class of bug**, and to the one it replaces.

**7. Then** onboarding verification + Georgia Tech (Gate A), which has been blocked on exactly this.

## 📋 PASTE-READY RESUME TEXT (for a fresh session)

> Resuming RSTR IQ on `feature/war-recalibration`. Read
> `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md` first — it is current.
>
> Context: two root causes were found and FIXED IN CODE on 2026-09-01. (1) Gate B — prod's returner
> wRC+ ran a different equation because the legacy `"Equation Weights"` 2025 table overrode the code
> defaults; proven by the legacy formula reproducing the stored value for 5,122/5,122 D1 returner
> hitters vs 1,164 for canonical. (2) C1 — ERAs ran ~4% low because the calibration had no division
> filter (477 JUCO = 27% of the sample) and the z-shift assumed PR+ centres at 100 when the true
> D1/IP>=40 centres are 109.73–123.16.
>
> Config consolidation steps 1–3 are DONE: the legacy table is renamed `_LEGACY_2025` on both
> databases, the legacy reads are removed, and `model_config` (admin_ui, season 2026) is now the single
> source of truth with the rating centres wired into the `fields` mapping.
>
> **NOTHING HAS BEEN WRITTEN TO EITHER DATABASE'S `model_config`, AND NO PROJECTION HAS BEEN
> RECOMPUTED.** Every stored `p_era` / `p_war` / `p_wrc_plus` / `market_value` still carries both
> biases.
>
> **Resume at STEP 4** in that handoff: apply the calibration to staging, then prod, then mirror the
> edge function, then re-run precomputes and verify ACROSS THE RANGE (p05/p10/median/p90 — a mean-only
> check is blind to this class of bug). Do not redo steps 1–3.

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
