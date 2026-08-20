# PROD PUSH RUNBOOK — WAR Recalibration + Pitch-Log Migration

**Date:** 2026-08-20 · **Branch:** `feature/war-recalibration` · **Status:** PRE-PUSH (nothing run to prod)
**This is the authoritative, execution-ordered manifest for this push.** It supersedes the scattered/contradictory WAR-recalibration sections in `PROD_MIGRATIONS_TODO.md`. Companion audit: `docs/AUDIT_war_recalibration_state.md`.

**Rules of the road:** every DB change is logged here the moment it lands on staging. Prod values are **regenerated on prod** (never copied from staging) unless explicitly noted. Trevor drives the prod merge. **JUCO is out of scope** (separate audit/session).

---

## PART A — DB CHANGE LEDGER (everything that must change on prod)

### A1. Tables CREATED
| Object | Migration | Prod action |
|---|---|---|
| `team_season_stats` | `20260819000000_*` | CREATE, then populate via `refresh_team_season_stats(2026)` (runs LAST — see order) |
| `player_season_defense` / baserunning | `20260805_player_season_defense_baserunning.sql` | ⚠️ **currently staging-only, NO prod path** — needs one; load-bearing for d/bsr-WAR |

### A2. Columns ADDED (then backfilled)
| Table | Columns | Migration |
|---|---|---|
| Pitching Master | `desc_pwar(_reg)`, `desc_ra9(_reg)`, `desc_fip_ra9(_reg)`, `total_desc_war(_reg)`, `drs_behind(_reg)`, `regular_season_ip` (11) | WAR-redesign migs |
| Hitter Master | `desc_owar(_reg)`, `d_war(_reg)`, `bsr_war(_reg)`, `total_desc_war(_reg)`, `woba(_reg)`, `wraa(_reg)`, `regular_season_pa` (13) | WAR-redesign migs |
| Conference Stats | `hitter_talent_plus`, `run_env_factor`, `updated_at` (3) | conf-stats migs |
| pitch_log | `park_code`, `game_string`, `is_conference_game` (+ deferred: `vaa`, `classification_version`) | pitch-log migs |
| pitch_log | attribution half (`atbat_desc`, event cols) | `20260806_pitch_log_widen_attribution.sql` |

*Note: `era_pr_plus`…`hr9_pr_plus`, `trackman_pitches`, `p_rv_plus` already exist on BOTH sides — value change only.*

### A3. Tables/Columns DROPPED (tracked — none destructive on this branch)
| Object | Status | Safety |
|---|---|---|
| `team_war_snapshots` | **DO NOT DROP** — stale doc language only; NO migration drops it. Holds prod's irreplaceable 2025 champions. | Federate-by-era: keep for pre-2026. |
| `player_prediction_internals` | Deferred (item J) — only after `bulkRecalc`/`import-internal-ratings` retired | Gate: 0 readers first |
| Conference Stats `iso/obp_power_rating` (prod-only) | ⚠️ **RECONCILE, don't drop** — still read by `ConferenceStatsPage`/Savant. Confirm staging reads new `obp_plus`/`iso_plus` first. | Verify display before any drop |
| `abs_hitter_stats`/`abs_pitcher_stats` | drop+recreate in same migration (reshape) | Re-importable |

### A4. `model_config` (season 2026) — 58 keys differ (staging 125 vs prod 79)
- **New weight blocks:** `ba_*`(4), `iso_*`(6), `obp_*`(6), `p_era_*`(7), `p_whip_*`(7), `p_hr9_*`(6), `pfip_*`(5), `pwar_*`(4), `plg_ra9`, `r_w_intercept`, `t_w_intercept`.
- **Changed constants:** `owar_runs_per_win` 10→13.1, `owar_run_value_per_pa` 0.13→0.3994, `owar_replacement_runs_per_600` 25→21.22, `r_ncaa_avg_wrc`/wRC weights (OBP .45→.691, SLG .3→.235, avg/iso→0).
- **NEW — store-everything mirror (read-only):** add the SD/constant values that currently live only in code, so DB + admin match code (see Part C).

### A5. `ncaa_averages` (2026)
- Re-derive all means/SDs (staging updated 2026-05-14). Notably `wrc` 0.357→0.3782.
- ⚠️ **FIX:** `pitcher_exit_velo` + `pitcher_in_zone_pct` are NULL on staging — must be **computed as NCAA-wide weighted averages from pitch log** (matching the hitter-side method) and stored, on **both** staging + prod. (New function — see Part C.)

### A6. Backfills
`pitcher_full_name` (corruption fix, 1 name/pitcher_id) · `park_code`/`game_string` (~99%) · descriptive WAR (desc_*) · composite WAR · team_season_stats.
⚠️ Confirm globally with server-side `count(*) FILTER (WHERE park_code IS NULL)` + `HAVING count(DISTINCT pitcher_full_name)>1` before push (audit used sampling).

---

## PART B — EXECUTION ORDER (the dependency chain)

1. **`model_config` + `ncaa_averages`** (incl. `wrc=0.3782`, the exit_velo/in_zone fill) — everything downstream divides by these.
2. **Add all columns** (A2) — before any backfill that writes them.
3. **`player_season_defense`/attribution** (A1/A2) — before composite d/bsr-WAR.
4. **pitch_log backfills** (`park_code`/`game_string`) — before team_season_stats records re-key.
5. **Store recompute → scores → power ratings → descriptive WAR** (desc_*).
6. **`refresh_composite_war()`** — define, then fire only AFTER desc WAR + precompute.
7. **Precompute** returner + transfer (post-Phase-1 modeling lock).
8. **`refresh_team_season_stats(2026)`** — **LAST**; consumes all of the above + prod's own `team_war_snapshots` (2025 champions).
9. **Display swaps / WIRE C** — Phase 2 (per 2026-08-20 phasing).
10. **DROP items** (A3) — last, each behind its gate.

---

## PART C — THE 13 STEPS (D1 only, JUCO excluded)

**Key finding (2026-08-20):** the returner equation IS fully stored in `model_config` as `r_*` keys under `model_type='admin_ui'` (std_pr, class bases, damp tiers, ncaa avgs, wRC weights — all of it). The `recalculate-prediction` edge fn *reads* model_config but is **triple-broken**: filters `model_type='returner'` (0 rows → hardcoded defaults), checks **bare** key names (not `r_`-prefixed), and never reads `*_std_pr`. Deno edge fns can't import `src/` → **model_config genuinely IS their source of truth**, so "everything reads model_config" is required, not optional.

### A. Equation / SD fixes (canonical code + model_config)
| S | Step | Where |
|---|---|---|
| 1 | `whip_pr_sd` 24.59 → **37.13** (confirmed on latest ratings) | `pitchingEquations.ts:210` + add to `model_config` (edge fn reads it) |
| 2 | `obp_std_pr` 28.89 → **32.41** — **returner AND transfer** (it's `StdDevOBPPowerRating` in the returner equation) | `model_config` `r_obp_std_pr` + `t_obp_std_pr`; code fallbacks |
| 3 | **Conference env+ pitcher → ratio** `(conf/ncaa)×100` to match hitters (currently z×20) | `buildTransferPitcherInputs.ts` / `transferPitcherProjection.ts` |
| 4 | **Remove** the NaN fallback (dead path; "shouldn't be used") | `pitcherProjection.ts:301-339` |

### B. Edge-fn returner fix + unification (the real C5 — a rebuild, not a cutover)
| S | Step | Where |
|---|---|---|
| 5 | **Rewrite edge `recalc` (returner hitter) to the SD-blended model** — `ScaledOBP = NCAAAvgOBP + ((OBPPR+ − NCAAAvgPR)/StdDevOBPPR)×StdDevNCAAOBP` → `Blended = LastOBP×(1−PRWeight) + ScaledOBP×PRWeight` → `×(1 + ClassAdj + DevAgg·0.06)`. **Must use the power rating.** | `recalculate-prediction/index.ts` |
| 6 | **Rewire edge fn to READ ALL of model_config** — `r_*` returner + `t_*` transfer + `p_*` pitcher keys under `admin_ui`; correct key names; include the SDs. **No hardcoded fallbacks.** | edge fn config loader |
| 7 | **Consolidate returner *pitchers* into the edge fn** (logged goal — one edge fn runs everything) — SD model, pitcher SDs from model_config | edge fn |
| 8 | **Delete dead** `bulkRecalc` + `fetchAllPredictionsForReturnerMode` (removes ReferenceError). Edge fn runs autonomously → **no local-path repoint/rebuild needed**; optionally leave a manual button that just calls the edge fn | `predictionEngine.ts`, `AdminDashboard.tsx`, `runDataCascade.ts` |
| 9 | **Edge-fn pitcher IP → depth-role IP**: last-year IP → depth role → projected IP (toggle-reactive), matching canonical | both edge fns `index.ts` |

### C. Store-everything / model_config + ncaa completeness
| S | Step | Where |
|---|---|---|
| 10 | Add pitcher `*_pr_sd` + `p_*` composite weights + ncaa avg/SD to `model_config` (edge fn reads them; admin displays them — must match code exactly) | `model_config` + admin UI |
| 11 | `ncaa_averages` `pitcher_exit_velo`/`pitcher_ev90`/`pitcher_in_zone_pct` = the **hitter averages 1-for-1** (same batted-ball population), stored both sides | fill function |

### D. Verify + run (SPLIT — returner now, transfer deferred)
| S | Step |
|---|---|
| 12 | Confirm canonical TS ↔ edge-fn math in lockstep (the duplicated math) |
| 13a | **RUN ALL RETURNERS NOW** (hitters + pitchers via edge fn) with the improved data/SDs |
| 13b | **TRANSFER: DO NOT RUN YET** — the transfer SD + weighted-impact (env+ ratio conversion + weights) is **not settled**. Finish + verify the transfer equation first, then run transfer separately. |

### E. Optional / deferred cleanup
| S | Step |
|---|---|
| C9 | Stale TB-sim pitcher weights (`useTeamBuilderSimulation.ts:349`), whip `chase 0.05` divergence (`usePitchingEquationWeights.ts:96`) — defer-able |

---

## PART D — LIMITATIONS REGISTER (known, accepted, or deferred)

| Limitation | Status |
|---|---|
| `pitch_log.vaa` 0% populated, `classification_version` ~65% | **KNOWN / DEFERRED** — upload miss, leaving for now |
| `team_season_stats` `_reg`-window rates + counting splits (sb/cs/er/outs) NULL | Documented deferral (only WAR stored per-window) |
| `park_hr9_single` NULL (only `park_hr9_rolling` set) | Minor; decide if single-season HR park needed |
| Returner SDs cannot move via DB (wrong model_type filter + key mismatch + empty Equation Weights) | Structural — returner constants are **code-only**; store-everything is read-only mirror |
| ERA in team_season_stats/rates is Master-IP-weighted (not pitch-log) | Intentional — Master is source of truth for ER |
| JUCO everything | **OUT OF SCOPE** — separate audit/session |
| Global backfill completeness (park_code/pitcher_full_name) verified by sampling | Run server-side full-table count before push |
| lgRA9 6.913 vs 6.915 | Intentional (centering vs conversion), benign |

---

## PART E — PHASED PLAN

- **Phase 1 — Repair + lock the RETURNER path (steps 1–12):** SD fixes (1,2,4,10), env+ ratio (3), edge-fn returner rebuild + model_config rewire + pitcher consolidation + dead-code delete + IP fix (5–9), ncaa 1:1 fill (11), lockstep verify (12).
- **Phase 2 — RUN RETURNERS ONCE (step 13a):** full returner recompute (hitters + pitchers) via the edge fn, improved data/SDs. **Transfer NOT run here.**
- **Phase 3 — Finish + verify the TRANSFER equation, THEN run it (step 13b):** settle the transfer SD + weighted-impact (env+ ratio conversion + weights) — deliberate, separate work — then run transfer.
- **Phase 4 — Prod push:** execute Parts A/B in execution order; Trevor drives merge. Reconcile A3 legacy columns (display check) before any drop.
- **Deferred / separate sessions:** JUCO audit + equation (out of scope now); vaa/classification backfill; edge-fn structural cleanup beyond unification; C9 duplicate-copy cleanup.

---

## PART F — PITCH-LOG-PRIMARY DERIVE → MASTERS (Step 1 of the pipeline, D1 only)

**Goal:** pitch log becomes the primary source; derive the full stat line and write into **both** Masters. TruMedia = sporadic fill/override. Script: `scripts/derive_masters_from_pitchlog.ts` (dry-run verified 2026-08-20, NOT applied).

**F1. `pitch_log_pitcher_totals.ip` column (per-PA out-attribution).** APPLIED STAGING 2026-08-20. PROD pending (re-run on prod, parameterize season).
```sql
ALTER TABLE public.pitch_log_pitcher_totals ADD COLUMN IF NOT EXISTS ip numeric;
WITH pa AS (SELECT game_string,pitching_team_id,inn,ab_num_in_game,min(pitcher_id) pid,min(outs) so
  FROM pitch_log WHERE season=2026 AND inn IS NOT NULL AND game_string IS NOT NULL AND ab_num_in_game IS NOT NULL
  GROUP BY game_string,pitching_team_id,inn,ab_num_in_game),
hi AS (SELECT game_string,pitching_team_id,inn,max(outs) mo FROM pitch_log
  WHERE season=2026 AND inn IS NOT NULL AND game_string IS NOT NULL GROUP BY game_string,pitching_team_id,inn),
seq AS (SELECT pa.pid,pa.so,hi.mo,lead(pa.so) OVER (PARTITION BY pa.game_string,pa.pitching_team_id,pa.inn ORDER BY pa.ab_num_in_game) ns
  FROM pa JOIN hi USING (game_string,pitching_team_id,inn)),
ipc AS (SELECT pid,sum(GREATEST(COALESCE(ns,mo+1)-so,0))/3.0 pl_ip FROM seq GROUP BY pid)
UPDATE public.pitch_log_pitcher_totals t SET ip=ipc.pl_ip FROM ipc
WHERE t.pitcher_id=ipc.pid AND t.season=2026 AND t.dimension_key='all';
```
Validated: IP corr 0.9995 / K9 0.9971 / BB9 0.9982 / WHIP 0.9959 vs Master.

**F2. UNIQUE constraints (needed for the derive upsert).** APPLIED STAGING 2026-08-20. PROD pending (dedup-check first).
```sql
ALTER TABLE "Hitter Master"   ADD CONSTRAINT hitter_master_src_season_uniq   UNIQUE (source_player_id, "Season");
ALTER TABLE "Pitching Master" ADD CONSTRAINT pitching_master_src_season_uniq UNIQUE (source_player_id, "Season");
```

**F3. Run the derive (script, --apply).** NOT YET RUN. Writes: hitters full line; pitchers scouting + K9/BB9/HR9/WHIP/FIP (**descriptive classic FIP** `(13·HR+3·(BB+HBP)−2·K)/IP+3.157`, NOT `computeProjFip` which is the projection/pWAR FIP). Never writes ERA/IP/G/GS/Role (TruMedia). Fill/override: null/thin → keep Master. Creates new rows for pitch-log-only players (2027). Dry-run: 4,374 hitters / 4,772 pitchers change.
