# ▶️ HANDOFF — 2026-09-01. Config sources, calibration, snapshot read path. **START HERE.**




## ★ NEUTRAL SNAPSHOT SOURCING — VERIFIED 2026-09-01 (returner = global · transfer = precomputed)

**Rule:** predRank is *team-scoped FIRST, global SECOND, never another team's precompute.* A returner
has no precompute at his own school → global. A transfer's team-scoped row IS the projection INTO
that school; using global would project him at his CURRENT school.

**Measured on staging after the refill (side-aware):**
```
team_build_players  returner 1,213 → 0 team-scoped · 1,203 global · 0 WRONG
                    target      41 → 36 team-scoped ·     5 global* · 0 WRONG
target_board        transfer   154 → 150 team-scoped · 4 TWP-pitcher-side · 0 WRONG
                    returner    13 →  12 global                          · 0 WRONG
  * 5 targets have no precompute for that team yet — global is the documented fallback.
```
⚠ The 4 "wrong" rows were a BAD QUERY, not bad data — all Josiah Overbeek, a TWP whose PITCHER-slot
board rows correctly hold pWAR. `coalesce(o_war, p_war)` pulled his hitter oWAR off the same row.
**Every snapshot check must be side-aware; a TWP carries both sides on ONE prediction row.**

⛔ **The two neutral scripts are NOT interchangeable — the tables use different shapes.**
`team_build_players` pitcher neutral = VERBATIM prediction row (77 keys incl. `variant`,
`customer_team_id`) → `backfill-neutral-snapshots.ts` (**PLURAL**) `--refresh`.
`target_board` = NORMALIZED (13/15 keys) → `backfill-neutral-snapshot.ts` (**SINGULAR**)
`--target-board-only`. Running the singular one unscoped STRIPS the verbatim build keys.

✅ Toggle-safe, proven: 1,207/1,207 build + 167/167 board neutrals at `dev_aggressiveness = 0`, while
59 build + 17 board rows keep a non-zero toggle in `production_notes`, untouched.
⛔ NEVER add a refresh flag to anything writing `player_snapshot`/`transfer_snapshot` from predictions.

Full runbook + exact commands: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## 🛑 SNAPSHOTS ARE COPIES — A PRECOMPUTE DOES NOT REFRESH THEM (2026-09-01)

**Symptom:** *"player profile is showing properly on staging but team builder is not."* That IS the
diagnosis. Player Profile / Dashboard / Top 5 read `player_predictions` **directly** (fresh instantly).
Team Builder / Target Board / GM hub read a **SNAPSHOT COPY** frozen at write time. Nothing cascades.

**Measured on staging right after the returner + transfer recomputes:**
```
team_build_players.player_snapshot   604 rows · 296 STALE · worst gap 3.907 WAR
team_build_players.neutral_snapshot  586 rows · 310 STALE
target_board.transfer_snapshot        74 rows ·  62 STALE · worst gap 50.0 wRC+
```

**RUN ORDER — predictions first, snapshots LAST:**
1. `precompute-returner-pitchers` → `precompute-returner-hitters` (pitchers FIRST; shared `market_value`, hitter must be last writer)
2. per team: `precompute-transfers -- --team <uuid>` + `precompute-pitchers -- --team <uuid>` (14 prod / 18 staging)
3. `backfill-build-snapshots -- --apply --force` ⚠ **`--force` REQUIRED** — without it the script only fills `player_snapshot IS NULL` rows and ours are populated-but-stale → **silent no-op**
4. `scripts/backfill-target-transfer-snapshots.ts --apply`
5. `scripts/backfill-snapshot-total-hitter-war.ts --apply` — MUST be last; steps 3/4 write `o_war` only. ⛔ It *skips snapshots that already have* `total_hitter_war`, so it only works because 3/4 overwrite the object first. **Never run it standalone after a recompute.**

⚠ **OPEN GAP: `neutral_snapshot` has NO refresh path.** `backfill-neutral-snapshots.ts` is `IS NULL` only, no `--force`. The 310 stale rows cannot be refreshed by any existing script, and it is the dev_agg=0 base every toggle reads. **NOT FIXED.**

**Named gate — Naulivou Lauaki Jr. (Oregon, R-FR):** wRC+ **113 → 101**, oWAR 0.966 → 0.436, market **$24,260 → $9,671**. ✅ verified on staging AND prod. Market moves ~60% on a 12-pt wRC+ change because oWAR scales off `(wRC+ − 100)` — arithmetic, not a bug.

Full runbook + SQL verify gates: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## ★ 2026-09-01 (PM) — CENTRES · total_hitter_war · CROSS-IMPL DIFF (commit `ffc161d`)

🛑 **New required gate: diff the deployed edge function against the local precompute over the same
team.** Code review, typecheck and eyeballing the output ALL passed on a function giving every `IF`
player a 10% market shortfall. Only the row-by-row diff caught it.
**Georgia, staging:** hitters **7,814/7,814 identical** (incl. market, after the `IF` fix);
pitchers **1,754/1,755 at IP>=40** — ⚠ sub-40 IP diverges (33% under 10 IP). **OPEN.**

- **Centres**: `predictionEngine` returner hitters were hardcoded at 100 and read `model_config` zero
  times; `transferPitcherProjection`'s `prCenter` params existed but **no caller passed them** (bb9's
  true centre is 121.68); `dsd` split at 100 in both transfer copies vs `prCenter` in
  `projectPitchingRate` — now the stored average everywhere. OBP correctly did not move (centre ≈100).
- **`total_hitter_war`**: six selects omitted it, so snapshots carried the oWAR COMPONENT (Helfrick
  2.5 → 5.02). `market_value` was in every select and always right — that asymmetry found it.
  **No backfill needed**; 0 hitter rows affected on either DB.
- **`IF`/`INF`/`INFIELD`** missing from the edge function's 1.1 tier — would have hit Georgia Tech's
  whole infield.
- **`from/to_*_plus` mean different things by `model_type`** — player rating on returner rows,
  CONFERENCE avg+ on transfer rows.
- **Last live compute removed** from the TeamBuilder add path (102 lines).
- **Loud fallbacks shipped** — unresolved `model_config` keys are now named, not silent.

✅ **RETRACTED 2026-09-01:** an earlier version of this block listed a `total_hitter_war` rounding
drift as OPEN. **It is not real.** Stored `total_hitter_war` = `o_war + d_war + bsr_war` EXACTLY on
**102,420/102,420** staging and **105,281/105,281** prod transfer rows (max drift 0.00000000).
The claim came from measuring the LOCAL components against the EDGE total — which proves the edge is
exact and says nothing about the local total. 🛑 Same error as the "sub-40 pitcher divergence": two
GENERATIONS of a row compared as if they were two IMPLEMENTATIONS. **Prove both sides are FRESH
before diffing.**

**Staging only — PROD UNTOUCHED.** Full detail: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


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

## ✅ STEP 4 DONE — calibration APPLIED to BOTH databases (2026-09-01)

`model_config` admin_ui/2026: **220 → 236 keys** on each DB (16 added, 25 changed). Gates, prod:
```
era_plus_ncaa_avg  5.483215 → 5.263544     fip 5.097954 → 4.430664   bb9 4.013998 → 3.773413
p_era_pr_center    109.725344   p_bb9_pr_center 123.161475   h_ba_pr_center 102.988686
non-calibration keys changed: 0
STORED PROJECTIONS UNCHANGED: 5,122 D1 returner hitters, mean wRC+ 98.82 — identical to baseline
```
Rollback references: `/tmp/calib/prod_before.json`, `/tmp/calib/staging_before.json` (220 keys each).
⚠ Staging and prod calibrate to slightly different values (different populations: n=1,325 vs 1,295) —
that is CORRECT, each database calibrates to its own data. Do not "sync" them.

**WEIGHTING = PER-ROW, by decision** — see the Track B ⚖️ block. Anchors and centres must always be
computed the same way on the same rows; mixing per-row and IP-weighted recreates C1 (~0.09 ERA).

## 🔒 NOTHING MAY BE HARDCODED — 66 CONSTANTS STILL REQUIRE A DEPLOY (logged 2026-09-01)

**Trevor's standing rule:** *"we don't want anything hardcoded and unchangeable, that's my main thing."*

**MEASURED against `src/lib/pitchingEquations.ts` `DEFAULT_PITCHING_WEIGHTS` (115 constants):**
```
✅ tunable via model_config : 49
🔒 HARDCODED (no key)       : 66

  24  class transition adjustments   class_era_fs/sj/js/gr, class_fip_*, class_whip_*, …
  12  composite weights              fip_plus_weight, era_plus_weight, whip_plus_weight, …
  12  SP↔RP role transition          sp_to_rp_reg_era_pct, rp_to_sp_low_better_tier*_mult, …
   9  MARKET / dollars-per-WAR       market_tier_sec, market_dollars_per_war, market_pvf_*, …
   6  plus scales                    era_plus_scale, fip_plus_scale, …
   3  projected IP per depth role    pwar_ip_sp, pwar_ip_rp, pwar_ip_sm
```

⚠ **THE GROUPS MATTER MORE THAN THE COUNT.**
- `market_tier_sec` / `market_dollars_per_war` — **a program's pay-per-WAR cannot be tuned without
  shipping code.** A business lever living in a source file.
- `pwar_ip_sp/rp/sm` — projected innings per depth role, which drives EVERY pWAR.
- `class_era_*` — the class-progression adjustments. These were the prime suspect for the ~4% ERA bias
  before it was traced to the anchor/centre; had they been the cause, fixing them would have needed a
  DEPLOY.

**✅ NOTHING IS BROKEN TODAY.** All 127 edge-function constants resolve correctly:
46 overlaid from `model_config` · 72 identical to `src/lib` · 9 differ but are read through
`readEquationValue`, which checks `model_config` FIRST. Onboarding uses the same numbers as the batch.

🛑 **THE REAL DANGER IS SILENCE, NOT THE VALUES.** These are *fallbacks*. They fire only when a
`model_config` key is missing — and when they do, they substitute a stale constant with **no warning**.
That is the identical failure shape as every bug found on 2026-09-01.

### ORDER OF WORK — deliberately sequenced
| # | work | when | why that order |
|---|---|---|---|
| **A** | **Loud fallbacks.** `readEquationValue` + both overlays log every key they could NOT resolve. | **NOW — cheap, no behaviour change** | Converts the whole class from silent to visible. This is the actual mitigation. |
| **B** | Step 6 — re-run precomputes, verify across the range | next | Establishes a clean verified baseline |
| **C** | Gate A — onboarding verification + Georgia Tech | after B | **NOT blocked by the 66.** GT would use the same constants the batch uses. |
| **D** | **Seed the 66 into `model_config`** + add to the `fields` mapping | **after C** | ⚠ Touches MARKET VALUES and pWAR. Doing it between the calibration fix and the recompute would land two uncontrolled changes inside one verification. |

⛔ **D IS NOT PURELY MECHANICAL.** `loadPitchingPowerEq` filters to `p_`-prefixed keys only, so each
group needs a prefix decision first — and `market_*` is **shared with the hitter market path**, so it is
not a pitching-domain key at all. Getting a prefix wrong recreates the written-but-never-read problem
that made stage 5.5 inert. Settle naming BEFORE writing any key.

## ▶️ RESUME HERE — STEP 5. (Steps 1–4 are done; do not redo them.)

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

> Resuming RSTR IQ on `feature/war-recalibration` (PR #171 → `staging`).
>
> **READ FIRST, IN THIS ORDER:**
> 1. `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md` — **THIS FILE. Current state, the
>    three-config-system discovery, both solved gates, steps 1–3 done, resume at step 4.**
> 2. `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md` — the GATES. Gate A (onboarding),
>    **Gate B (wRC+ — SOLVED, old hypotheses archived in place)**, Gate C (ERA/HR9 calibration), plus
>    the logged shortcomings: small-sample pRV+, the 146 stale projections, and the CLOSED relink.
> 3. `docs/PIPELINE_pitch_log_to_projections.md` — **TRACK B, the canonical build spec.** Stage 5.5 =
>    calibration + rating centres. Contains the three MUST READ blocks: *where constants come from*,
>    *the `model_config` key naming convention*, and *stage 5.5 is D1-only / the z-shift does not
>    subtract 100*. Also the AUTOFILL requirement (stage 5.5 must run from the upload chain — NOT BUILT).
> 4. `docs/AGENT_LEARNINGS_snapshot_read_path_2026_09_01.md` — why four surfaces disagreed and the
>    doctrine that came out of it (**read the same ROW, don't compute the same ANSWER**).
> 5. `docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md` — the two-sided SD
>    method (correct as designed) **plus the MUST READ correcting its population choices**.
>
> **WHEN YOU ARE ABOUT TO RUN SOMETHING:**
> · `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` — the steps · `docs/PROD_PUSH_BULLETPROOF_CHECKLIST.md`
> — the GATES that must be true (VALUE/MEMBERSHIP/CARDINALITY/LOG-CONTENT, never counts or exit codes) ·
> `PROD_MIGRATIONS_TODO.md` — every prod migration incl. the unapplied 41-key `model_config` upsert ·
> `docs/JUCO_AUDIT_2026_05_24.md` — JUCO is knowingly wrong and PARKED; do not chase it.
>
> **CODE ENTRY POINTS:** `scripts/compute-projection-calibration.ts` (stage 5.5 producer) ·
> `src/lib/pitchingEquations.ts` (the `fields` mapping — **a key is INERT unless listed there**) ·
> `src/lib/predictionEngine.ts` (`loadEngineConfig`, the returner/transfer configs) ·
> `src/hooks/useActiveBuildSnapshot.ts` (the one snapshot resolver) ·
> `supabase/functions/process-precompute-jobs/index.ts` (onboarding — still has its own constants and
> its own hardcoded `100`).
>
> **CONTEXT.** Two root causes were found and **FIXED IN CODE** on 2026-09-01. **(1) Gate B** — prod's
> returner wRC+ ran a different equation because the legacy `"Equation Weights"` 2025 table overrode the
> code defaults; proven by the legacy formula reproducing the stored value for **5,122/5,122** D1
> returner hitters vs **1,164** for canonical. **(2) C1** — ERAs ran ~4% low because the calibration had
> no division filter (**477 JUCO = 27% of the sample**) and the z-shift assumed PR+ centres at 100 when
> the true D1/IP≥40 centres are **109.73–123.16** (bb9 worst).
>
> Config consolidation **steps 1–4 are DONE**: legacy table renamed `_LEGACY_2025` on BOTH databases,
> legacy reads removed, `model_config` (admin_ui, season 2026) is the single source of truth, the rating
> centres are wired into the `fields` mapping, and **the calibration is APPLIED to BOTH databases**
> (220 → 236 keys; `era_plus_ncaa_avg` 5.483215 → 5.263544 on prod).
>
> ⚖️ **Weighting is PER-ROW by decision** (each qualified pitcher counts once; volume is carried by
> `projected_ip`). Anchors and centres MUST always be computed the same way on the same rows — mixing
> per-row with IP-weighted recreates C1 in miniature (~0.09 ERA).
>
> 🛑 **`model_config` IS NOW APPLIED, BUT NO PROJECTION HAS BEEN RECOMPUTED.** Every stored `p_era` /
> `p_war` / `p_wrc_plus` / `market_value` still carries both biases, and **no displayed number has
> changed** — verified: 5,122 D1 returner hitters at mean wRC+ 98.82, identical before and after.
>
> **RESUME AT STEP 5.** Mirror the edge fn → re-run precomputes →
> verify **ACROSS THE RANGE** (p05/p10/median/p90 on the **QUALIFIED** population, IP>=40 — comparing
> against the full population's 6.902 mean would look alarming and mean nothing).
> **Do not redo steps 1–4.**
>
> **THEN, IN THIS ORDER — the hardcoded-constant work is sequenced deliberately, do not reorder:**
> **A)** loud fallbacks now (`readEquationValue` + both overlays log every key they cannot resolve —
> cheap, no behaviour change); **B)** step 6 recompute + across-the-range verify; **C)** Gate A
> onboarding + Georgia Tech — **NOT blocked**, GT uses the same constants the batch uses; **D)** seed
> the **66 hardcoded constants** into `model_config`, only after C.
> Measured: `DEFAULT_PITCHING_WEIGHTS` has 115 constants — **49 tunable, 66 not** (24 class transitions ·
> 12 composite weights · 12 SP↔RP role · **9 market/dollars-per-WAR** · 6 plus scales · **3 projected IP
> per depth role**). Nothing is broken today (all 127 edge-fn constants resolve: 46 overlaid · 72
> identical · 9 via `readEquationValue`, which checks `model_config` first) — the danger is that they are
> SILENT fallbacks. ⛔ D needs a NAMING decision first: `loadPitchingPowerEq` only accepts `p_`-prefixed
> keys and `market_*` is shared with the hitter path, so a wrong prefix recreates the
> written-but-never-read trap. Full detail in this doc above and in Track B.

## 📚 DOCUMENT MAP — what lives where

| document | role | read it when |
|---|---|---|
| **`docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md`** | **THIS FILE — current state + resume point** | **first, always** |
| `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md` | the GATES (A onboarding · **B wRC+ SOLVED** · C ERA/HR9) + logged shortcomings | before starting any gate |
| `docs/PIPELINE_pitch_log_to_projections.md` | **TRACK B — canonical build spec**, 19-stage order, all MUST READs, key-naming convention, autofill requirement | before touching any stage |
| `docs/AGENT_LEARNINGS_snapshot_read_path_2026_09_01.md` | why 4 surfaces disagreed; the read-the-same-row doctrine | touching profiles / TB / GM hub / target board |
| `docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md` | two-sided SD method + the correction to its population choices | touching calibration or SDs |
| `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` | the step list | when running the push |
| `docs/PROD_PUSH_STEPS_2026_08_26.md` | step ordering | when sequencing |
| `docs/PROD_PUSH_BULLETPROOF_CHECKLIST.md` | gate DEFINITIONS + measured values | before/after every step |
| `docs/PROD_PUSH_BULLETPROOF_CHECKLIST_BRANCHWIDE.md` | branch-wide readiness + **SILENT-FAILURE REGISTRY** | before promoting anything |
| `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md` | earlier resume point (⚠ its projection verifications are VOID — computed against the legacy formula) | historical only |
| `docs/HANDOFF_2026_08_31_EOD.md` | prod state as of 08-31 | for "what was true then" |
| `docs/HANDOFF_WHATS_AHEAD_2026_08_31.md` | Track B blockers + the earned rules | planning |
| `docs/HANDOFF_RESUME_2026_08_31_SNAPSHOTS.md` | snapshot state (⚠ numbers inside carry the bias) | snapshot work |
| `docs/HANDOFF_2026_08_31_MASTERS_AND_TRACKB.md` | Track B architecture write-up | architecture questions |
| `PROD_MIGRATIONS_TODO.md` | **every prod migration** — incl. the UNAPPLIED 41-key upsert and the completed legacy rename | before any prod write |
| `docs/JUCO_AUDIT_2026_05_24.md` | JUCO is knowingly wrong and PARKED | **so you do not chase JUCO** |
| `docs/FUTURE_WORK_BACKLOG_2026_08_26.md` | deliberately deferred work | when tempted to widen scope |

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
