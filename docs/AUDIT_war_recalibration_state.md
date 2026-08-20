# AUDIT — WAR Recalibration Branch State (`feature/war-recalibration`)

**Date:** 2026-08-20
**Purpose:** Comprehensive pre-push audit. Every change on this branch classified as **confirmed clean**, **possibly touched**, or **limitation/broken** — so we know exactly where we stand before continuing.
**Method:** 8 parallel verification streams — 6 code/logic subsystems (each ran tests + spot-checked stored values against staging DB) + staging↔prod DB delta + prod-push doc accuracy. No files or DBs modified during the audit.

---

## 0. Overall verdict

**The production-driving core is sound.** The stored, canonical values that actually feed projections/WAR/market are correct and DB-verified: WAR formulas exact, power-rating composites match the refits, `team_season_stats` rollups exact, pitch_log corruption fixed. **269/269 tests pass.**

**The risk is NOT in the canonical path — it's in three places:**
1. **Stale SD constants** (`whip_pr_sd`, `obp_std_pr`) that mis-scale the returner/transfer power adjustment.
2. **Duplicate/fallback copies** that didn't get the refit and are currently *shadowed* by stored values (latent landmines).
3. **One over-eager dead-code deletion** that orphaned a live function and **breaks the returner-hitter recompute path** — which we need for the planned run.

**Not safe to push or recompute until the 🔴 items below are resolved.** None are deep — they're targeted fixes.

---

## 1. ✅ CONFIRMED CLEAN (verified with evidence)

| Area | Evidence |
|---|---|
| **WAR formulas** (wRC+ C1, oWAR, pRV+/D1-FIP, pWAR) | Match spec exactly (`wrc.ts:17`, `war.ts:13-65`, `pitcherQuality.ts:24-51`). Constants (RPW 13.1, 0.3994, 21.22, 6.915, 1.92) consistent across `src/`, edge fn, SQL. No stray RPW=10 / 0.13 / 25. |
| **Composite WAR** total = o+d+bsr | Verified live on staging: 5 hitters + 5 pitchers reproduce to full float precision. `÷10` in `20260806_composite_war_and_refresh` superseded by `÷13.1` rescale. |
| **Power ratings canonical** (`powerRatings.ts`) | Every hitter+pitcher composite matches the 2026-08-11 refits (era⁺ −izWhiff, whip⁺ bb/whiff/stuff, hr9⁺ +hard_hit, obp⁺ 57/43, iso⁺ pull_air). Inversions correct. Stored `*_pr_plus` reproduce from stored scores (Δ<0.01, 5 pitchers + hitters). |
| **team_season_stats** | 308 rows, no dupes. WAR rollups = Σ Masters **exactly (max diff 0.0000)** across all 308 teams. Records correct (Georgia 53-14, 23-7 SEC), keyed on game_string (DH-safe). Rates plausible, outs-tracking IP. |
| **pitch_log backfills** | `pitcher_full_name` corruption **fixed** — each pitcher_id → exactly 1 name (sampled 5 teams). `park_code`/`game_string` 100% on samples. Ingest code resolves name from stable pitcher_id (`ingest_pitch_log.ts:334`). |
| **Transfer — PVF bug** | **Fixed in all copies** (canonical `depthRoles.ts:267`, pitcher lib `:435`, edge fn `:676`). SP-market ~20%-high bug closed. |
| **Transfer — hitter rate + market parity** | Edge fn matches canonical line-for-line. Market: hitter total×PVM, pitcher no-PVF — consistent all copies. |
| **Migrations safe** | **No migration drops any irreplaceable table.** No `DROP team_war_snapshots` / `player_prediction_internals` / `park_factors` exists in code. Only DROP is `abs_stats_v2` (drop+recreate, re-importable). Coupled-drop worries are both non-events. |
| **Tests** | 269/269 pass (12 files), ~3.7s. |

---

## 2. ⚠️ POSSIBLY TOUCHED — fallback/duplicate drift (shadowed by stored values, latent)

These do **not** affect the stored canonical values today, but they are real drift that will bite if a stored value is ever null or if a fallback path surfaces.

| # | Item | Location | Note |
|---|---|---|---|
| A | **Stale pre-refit pitcher weights** in TB sim | `useTeamBuilderSimulation.ts:349` | OLD era/whip/hr9 composites (izWhiff present, no hard_hit). Mitigated: prefers stored `era_pr_plus ??` (0 nulls → rarely fires). |
| B | **whip `chase 0.05`** locked constant | `usePitchingEquationWeights.ts:96`, `predictionEngine.ts:723` | Canonical whip has **no chase term**; live recompute sums to 1.05, won't equal stored. |
| C | **Dead 260-PA oWAR block** never deleted | `transferProjection.ts:124-129` | Confirmed inert (nothing reads `.owar`), directive to delete not executed. |
| D | `era_pr_sd` 5% high, `hr9_pr_sd` 6% high | `pitchingEquations.ts` | Within tolerance; slightly compress power adj. Optional recalibration. |
| E | `park_hr9_single` 308/308 NULL | refresh fn step 10 | Only `park_hr9_rolling` assigned. Minor asymmetry. |
| F | `_reg`-window rates NULL, counting splits (sb/cs/er/outs) NULL | `team_season_stats` | Documented deferrals, not bugs. |
| G | `lgRA9` 6.913 (pRV+) vs 6.915 (pWAR) | `pitcherQuality.ts:30` / `pitchingEquations.ts:239` | Intentional (centering vs conversion), 0.002 gap, benign. |
| H | CLAUDE.md stale | — | References `.skip` tests that were deleted; nothing hidden. Update the doc. |

---

## 3. 🔴 MUST-FIX before pushing or recomputing

| # | Item | Location | Impact |
|---|---|---|---|
| **1** | **Orphaned `fetchAllPredictionsForReturnerMode`** — deleted by commit `54cdb10`, still called | `predictionEngine.ts:877` (inside `bulkRecalculatePredictionsLocal`) | Runtime `ReferenceError` on **AdminDashboard recompute** + **`import-juco` cascade**. **BLOCKS the planned returner-hitter recompute.** `vite build` hides it; `tsc` catches it (TS2304). Fix: restore the fn or finish retiring bulkRecalc. |
| **2** | **`whip_pr_sd` stale** 24.59 → **37.1** | `pitchingEquations.ts:210` (code-only) | 34% too small → WHIP power adjustment ~1.5× over-scaled. Feeds **both** returner + transfer pitchers. |
| **3** | **`obp_std_pr` stale** 28.89 → **32.4** | returner: `predictionEngine.ts:330` (code) · transfer: `buildTransferProjectionInputs.ts:244` + DB `t_obp_std_pr` | 11% too small → OBP power adj over-fires. **Returner is code-only** (see trap below). |
| **4** | **NaN fallback** in live pitcher projection | `pitcherProjection.ts:301-339` | Reads `eq.p_*` composite weights **never defined** in `pitchingEquations.ts` → NaN. Shadowed by stored values + `??` (but `??` doesn't catch NaN). Dead/broken fallback. |
| **5** | **Conference env+ scale inconsistency** (modeling) | `transferPitcherProjection.ts` / `buildTransfer*Inputs.ts` | Pitcher env+ = `z×20`; hitter env+ = `(conf/ncaa)×100` ratio — fed into the same `(toPlus−fromPlus)/100`. Decision: put pitcher on the ratio. |
| **6** | **Edge-fn pitcher projected-IP drift** | edge `index.ts:697,792` vs canonical `transferPitcherProjection.ts:329` | Edge uses coarse role IP (no `ip` input field); canonical uses depth-role IP. Skews edge pitcher pWAR + market. Hitter side already fixed. |

### 🚩 Latent trap (not a bug to fix, a fact to remember)
**Returner SDs cannot be changed via the DB.** The returner reads `model_config` filtered on `model_type='returner'`, but every staging row is `admin_ui` (zero returner rows), the "Equation Weights" table is empty, and the key names mismatch (`obp_std_power` code vs `r_obp_std_pr` DB). **Any prod step that "updates the DB" for a returner constant silently no-ops.** All returner-constant fixes must be **code edits**.

---

## 4. 🚩 FLAGS needing Trevor's decision (from staging↔prod delta)

| Flag | Detail |
|---|---|
| **ncaa_averages nulls** | Staging **nulled** `pitcher_exit_velo` + `pitcher_in_zone_pct` (prod has them populated). Intentional re-base, or accidental? Downstream scores read these. |
| **Conference Stats renamed cols** | Prod has `iso_power_rating` / `obp_power_rating`; staging does **not** (staging added `hitter_talent_plus`, `run_env_factor`, `updated_at`). Renamed on purpose, or dropped? |
| **Incomplete backfills** | `pitch_log.vaa` is **0% populated even on staging**; `classification_version` ~65%. Not push-ready as-is. |

---

## 5. Staging → Prod delta (the actual push surface)

**Schema (add on prod):** `team_season_stats` (create + populate, 308 rows) · Pitching Master +11 cols (`desc_*`, `drs_behind`, `regular_season_ip`) · Hitter Master +13 (`desc_owar`, `d_war`, `bsr_war`, `woba`, `wraa`, `regular_season_pa`) · Conference Stats +3 (`hitter_talent_plus`, `run_env_factor`, `updated_at`) · pitch_log +cols (`park_code`, `game_string`, `is_conference_game`, …). *Note: `era_pr_plus`…`hr9_pr_plus` already exist on BOTH sides — the power-rating rebuild is a value change, not schema.*

**Config (`model_config`, 58 keys differ; staging 125 vs prod 79):** new weight blocks (`ba_*`, `iso_*`, `obp_*`, `p_era_*`, `p_whip_*`, `p_hr9_*`, `pfip_*`, `pwar_*`) + changed constants (RPW 10→13.1, run-value 0.13→0.3994, replacement 25→21.22, wRC+ OBP .45→.691 / SLG .3→.235 / avg,iso→0). **Plus the whip/obp SD fixes are CODE, not config.**

**Data:** `ncaa_averages` re-derived (means/SDs), + the flagged nulls.

---

## 6. Prod-push doc (`PROD_MIGRATIONS_TODO.md`) problems

- **6 migrations unlogged** — incl. **load-bearing** `player_season_defense_baserunning` (d/bsr-WAR tables, marked staging-only, no prod path → composite WAR silently breaks on prod without it) + `pitch_log_widen_attribution`, `composite_war_and_refresh`, `target_board_twp_two_row`, `neutral_snapshot`, `player_slot_values_uniq`.
- **Stale `DROP TABLE team_war_snapshots` language** in the doc (2 places) — confirmed **NOT an actual migration**, just dangerous doc text; the federate-by-era decision keeps the table. Must be deleted from the doc.
- **park_code backfill contradicts itself** (line 229 "NOT DONE" vs 281 "RUNNING").
- **Filename order, not execution order** — one dependency chain (`ncaa_averages.wrc` before every recompute; schema-before-backfill; `team_season_stats` refresh dead last).
- **SD-audit item stale** — must be updated to the whip/obp findings (was "no re-tune needed" per an older commit).

---

## 7. Go-forward plan

**Phase 1 — Repair + lock the modeling (do as a coherent set, verify, then run once):**
- 🔴1 restore `fetchAllPredictionsForReturnerMode` (unblocks returner recompute)
- 🔴2 `whip_pr_sd` → 37.1 (code)
- 🔴3 `obp_std_pr` → 32.4 (returner code + transfer code + DB `t_obp_std_pr`)
- 🔴4 fix/remove the `pitcherProjection.ts` NaN fallback
- 🔴5 conference env+ pitcher→ratio (decision + implement)
- 🔴6 edge-fn pitcher depth-role IP (decision: fix now vs Phase-2 edge-fn pass)
- Optional: ⚠️A/B/C/D duplicate-copy cleanup (or explicitly defer)
- Resolve §4 flags

**Phase 2 — Run once:** full returner recompute (all stats) + transfer recompute — only after Phase 1 locked, so we run correctly a single time.

**Phase 3 — Prod push:** off a corrected, execution-ordered `PROD_MIGRATIONS_TODO` (§6 fixed). Trevor drives the merge.

---

## Appendix — verification stream sources
1. WAR formulas · 2. Power ratings · 3. Transfer engine · 4. Returner + SD constants · 5. team_season_stats + backfills · 6. Migrations + dead code · 7. staging↔prod DB delta · 8. prod-push doc accuracy. All read-only. Full per-stream detail available on request.
