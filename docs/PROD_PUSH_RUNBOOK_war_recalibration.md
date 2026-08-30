# PROD PUSH RUNBOOK — WAR Recalibration + Pitch-Log Migration

> ▶️ **START HERE for the prod push: `docs/HANDOFF_2026_08_30_PROD_PUSH.md`** (current state, next actions in order, mistakes not to repeat, standing rules).
> ## ★ CURRENT STATE — READ FIRST (2026-08-30). This supersedes every older statement in this file.
> - **LANE (TOP DOG):** the only correct Stuff+ lane is the **pitch_log lane** —
>   `pitch_log.pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus` →
>   `aggregate_pitch_log_dimensions.ts` → `pitch_log_pitcher_totals` / `_by_pitch_type` → Season Stats + PitcherProfile.
>   **armHB throughout, self-consistent, CORRECT.**
> - **LEGACY LANE (≤2025 + JUCO ONLY, NEVER 2026):** `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
>   `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. It stores RAW hb, and since commit `e5dec2f` the
>   shared equations expect armHB — so running it scores **LEFT-HANDERS BACKWARDS**. Not live, not on main. Every step in
>   this document has been rewritten onto the pitch_log lane; if you find one that still routes through the legacy lane,
>   it is WRONG. (`legacy_breakingBallReclassification.ts`, renamed from `breakingBallReclassification.ts`, never touched
>   `pitch_log` and is NOT the anchor classifier.)
> - **CLASSIFIER:** `src/savant/lib/stuffPlusClassifierV2.ts` is the SINGLE source (`scripts/reclassify_v2.ts` is only a
>   validation harness; its duplicate copy was deleted). **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix /
>   needs_review 8.1%** on the full 2,000,674-pitch population. ⚠ SUPERSEDED — never quote as current: **92.6%, 94.3%,
>   95.1%, "~85%", and any "projected ~95.3-95.4%"**.
> - **DECISION (Trevor, FINAL):** standardize on v2 in **BOTH** environments — **DO overwrite staging's labels.** Any
>   "do NOT overwrite staging's labels" guidance anywhere is REVERSED and obsolete.
> - **STAGING:** the v2 chain is RUN + VERIFIED — backup `_v2_prechain_backup` (2,579,655 rows, DO NOT DROP) ·
>   2,015,321 classified/stamped `v2-ranges-2026-08-28` (needs_review 8.1%) · `_reclass_pf` materialized (5,364
>   pitchers) · baseline armHB SIGN CHECK PASSED 18/18 · 2,015,321 scored + recentered (every type×hand bucket exactly
>   100.0) · step 4 all 48 dimensions + `populate_hitter_run_values`. **Still open on staging:** step 5
>   `derive_masters_from_pitchlog.ts` is DRY-RUN ONLY (0 hitters / 4,675 pitchers would change; never applied on ANY env).
> - **PROD:** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

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
| pitch_log | `park_code`, `game_string`, `is_conference_game`, **`classification_version` + `needs_review`** (`20260828000000_…`, APPLIED on prod 2026-08-28) (+ still deferred: `vaa`) | pitch-log migs |
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

### A7. TRANSFER LEVER STORAGE ⚠️ PENDING Trevor's weight decisions (2026-08-20) — see `HANDOFF_team_season_stats_2026_08_19.md` §TRANSFER LEVER
Not yet built on staging; queued once the weight/HR9/park decisions land. Applies to BOTH envs.
| Object | Change | Note |
|---|---|---|
| Conference Stats | ADD `era_plus, fip_plus, whip_plus, k9_plus, bb9_plus, hr9_plus` (pitcher env+, **ratio scale** `(conf/ncaa)×100`) | compute+store on upload (stored-not-live); columns don't exist today |
| Conference Stats | ADD/FILL `offensive_power_rating` (OPR — wire calc `conferenceScoutingAverages.ts:432` to store; 0/42 today) | + fill the 10 gaps in `hitter_talent_plus`/`WRC_plus`/`run_env_factor` |
| Conference Stats | ⚠️ **Re-tag/exclude 10 `NJCAA D1 … District` rows** mislabeled `division='D1'` | clean D1 = 30; contaminates any stored SD |
| Park Factors | ADD `era_factor`, `fip_factor` (= `rg_factor`) | `whip_factor`(=obp)/`hr9_factor`(=iso) already stored; enable pitcher park (weights currently 0) |
| model_config | store cross-conf env+ SDs (mirror) + updated transfer weights | **settled values also written in CODE** (`src/lib/transferWeightDefaults.ts`); DB = mirror |
| CODE | pitcher env+ **z×20 → ratio** conversion (`buildTransferPitcherInputs.ts`/`transferPitcherProjection.ts`) | the ratio decision — a code change, not just weight values |
Then re-run TRANSFER projections (deferred until this lands).

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
> 🛑 **THIS WHOLE SECTION IS SUPERSEDED FOR THIS PUSH (2026-08-30).** Steps 5, 6, 7 and 9 all target
> `recalculate-prediction`, which is **DEAD** — see `PROD_PUSH_STEPS_2026_08_26.md` ~~step 47~~ and G3 below.
> Returners are rebuilt by the batch scripts (STEPS steps 36–37). Only **step 8** (delete dead `bulkRecalc` /
> `fetchAllPredictionsForReturnerMode` from `src/`) is still live work. Retained below for history.
| S | Step | Where |
|---|---|---|
| 5 | 🛑 **DEAD / DO NOT BUILD OR RUN (2026-08-30).** ~~Rewrite edge `recalc` (returner hitter) to the SD-blended model … `recalculate-prediction/index.ts`~~ — superseded by the BATCH scripts (`precompute-returner-pitchers:prod` → `precompute-returner-hitters:prod`; `PROD_PUSH_STEPS_2026_08_26.md` steps 36–37 and the ~~step 47~~ DEAD marker). `recalculate-prediction` is **never deployed in this push**; the only edge fn deployed is `process-precompute-jobs`. See G3 below. | ~~`recalculate-prediction/index.ts`~~ |
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
| `pitch_log.vaa` 0% populated (absent on prod) | **KNOWN / DEFERRED** — nothing reads it; neither classifier nor scorer touches it |
| ~~`classification_version` ~65%~~ | ✅ **RESOLVED** — the column exists on prod (`20260828000000_…`) and the v2 chain stamps `v2-ranges-2026-08-28` on every classified row |
| `team_season_stats` `_reg`-window rates + counting splits (sb/cs/er/outs) NULL | Documented deferral (only WAR stored per-window) |
| `park_hr9_single` NULL (only `park_hr9_rolling` set) | Minor; decide if single-season HR park needed |
| Returner SDs cannot move via DB (wrong model_type filter + key mismatch + empty Equation Weights) | Structural — returner constants are **code-only**; store-everything is read-only mirror |
| ERA in team_season_stats/rates is Master-IP-weighted (not pitch-log) | Intentional — Master is source of truth for ER |
| JUCO everything | **OUT OF SCOPE** — separate audit/session |
| Global backfill completeness (park_code/pitcher_full_name) verified by sampling | Run server-side full-table count before push |
| lgRA9 6.913 vs 6.915 | Intentional (centering vs conversion), benign |

---

## PART E — PHASED PLAN

- **Phase 1 — Repair + lock the RETURNER path (steps 1–12):** SD fixes (1,2,4,10), env+ ratio (3), ~~edge-fn returner rebuild + model_config rewire + pitcher consolidation + IP fix (5–7, 9)~~ 🛑 **DEAD — `recalculate-prediction` is not deployed in this push (STEPS ~~step 47~~); returners = batch scripts (STEPS 36–37)**, dead-code delete (8, still live), ncaa 1:1 fill (11), lockstep verify (12).
- **Phase 2 — RUN RETURNERS ONCE (step 13a):** full returner recompute (hitters + pitchers) ~~via the edge fn~~ 🛑 **DEAD — via the BATCH SCRIPTS** (`precompute-returner-pitchers:prod`, then `precompute-returner-hitters:prod`; STEPS steps 36–37). The `recalculate-prediction` edge-fn path is superseded — do NOT run it. **Transfer NOT run here.**
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

---

## PART G — PIPELINE PIVOT (Steps 2–4, toward ONE edge fn). CODE ships with branch; the RUNS below execute on prod after the code merges.

**G1. `computeNcaaAverages.ts` (Step 2a) — CODE.** commit `f3c231d`. (a) `pitcher_exit_velo`/`pitcher_ev90` (mean+sd) pinned = hitter `exit_velo`/`ev90` 1-for-1 (was NULL / wrong `90th_vel`=fastball-velo). (b) `pitcher_in_zone_pct` added to map. (c) **Dual-writes mean+SD to BOTH `ncaa_averages` AND `model_config`** (`buildModelConfigRows`, keys `p_ncaa_avg_*`/`p_sd_*`/`r_*`/`t_*`). **PROD RUN:** re-run `computeAndStoreNcaaAverages(season)` on prod after Masters are pitch-log-fed → refreshes both stores. `wrc_sd` intentionally null.

**G2. `createPredictionsFromMaster.ts` (Step 3) — CODE.** commit `1ff06b7`. Writes per-stat `from_avg_plus/from_obp_plus/from_slg_plus` (= `ba/obp/iso_power_rating`) on insert+update; guard also fires on `from_obp_plus==null` so existing rows backfill. **PROD RUN:** re-run create_predictions so `from_obp_plus` (returner SD-blend input) populates.

**G3. Edge-fn returner rebuild (Step 4) — 🛑 DEAD / DO NOT BUILD OR RUN (confirmed 2026-08-30).** Superseded by the batch returner scripts (STEPS 36–37); `recalculate-prediction` is never deployed in this push. Retained below for history only. ~~CODE, NOT YET BUILT.~~ Rewrite `recalculate-prediction` `recalc()` to the SD-blend (per-stat `from_obp_plus`, `+0.011` wRC intercept, tiered damp), READ `model_config` `r_*`/`p_sd_*` (fix the `model_type='returner'`→0-rows + bare-key bugs), delete dead `bulkRecalc`/`fetchAllPredictionsForReturnerMode`. **PROD RUN:** recompute returners (H+P) once after code merges. Transfer deferred.

**G0. Stuff+ → `Pitching Master.stuff_plus` (MUST precede compute_scores) — REWRITTEN 2026-08-30 onto the pitch_log lane.**
Stuff+ is an INPUT to the pitcher power ratings (k9⁺/era⁺/whip⁺), so it must be FINAL before `compute_scores`.
⛔ **The old wording here routed this through `runBreakingBallReclassification` → `runStuffPlusPipeline` →
`rollupStuffPlusToMaster` (`scripts/recompute-stuff-plus.ts`). That is the LEGACY lane and is WRONG for 2026** — it
stores/passes RAW hb into armHB-expecting equations and scores LEFT-HANDERS BACKWARDS, and nothing displays its output.
**Do it via the pitch_log chain instead:** reclassify (`reclassify_prod.ts`, v2) → re-derive `pitcher_stuff_plus_ncaa`
→ score (`compute_pitch_log_stuff_plus.ts`) → aggregate (`aggregate_pitch_log_dimensions.ts --apply --direct`) →
`derive_masters_from_pitchlog.ts --apply`, which is what actually sets `Master.stuff_plus` (pitch-weighted per-pitch
Stuff+ from the totals; verified to match to 0.01). Full step detail + the 🛑 markers: "THE STUFF+ CHAIN" below.
⚠ Prod's `stuff_plus` is OLD (pre-venue-fixture, old CASE labels) → the full chain MUST run on prod, not just a rollup.

**G4. Execution order (prod, pipeline pivot):** F1/F2 (ip col + constraints) → **G0 = the full Stuff+ chain on the pitch_log lane (steps 1–5), which ENDS in F3 (`derive_masters_from_pitchlog.ts` → Masters, incl. `stuff_plus`)** → G1 (ncaa_averages+model_config) → compute_scores → G2 (create_predictions) → ~~G3 (recompute returners)~~ **[G3 is DEAD — see below]**.

> ✅ **AUDIT 2026-08-30 — THIS ORDER IS THE CORRECT ONE. `ncaa_averages` BEFORE `compute_scores`.** Verified in code:
> `src/lib/computeAndStoreScores.ts:206-211` (`fetchSeasonBaselines`) reads its means/SDs — including `stuff_plus` /
> `stuff_plus_sd` (`:249`) — out of the **`ncaa_averages`** table that `computeNcaaAverages` writes. Run
> `compute_scores` first and you z-score the new armHB Stuff+ against the stale legacy distribution (prod currently
> holds `stuff_plus 101.8341 / sd 6.06231`), and any missing field falls back to hardcoded defaults **silently**
> (`:212-215`). `docs/PROD_PUSH_STEPS_2026_08_26.md` listed these as 26 computeAndStoreScores → 27 computeNcaaAverages,
> which was **backwards**; that doc has been corrected to match this line. Order = **derive_masters → computeNcaaAverages → computeAndStoreScores**.
> ✅ **Both `computeNcaaAverages` defects are FIXED IN CODE (2026-08-30) — no hand-patching before the prod run.**
> (a) pagination now orders by each table's ACTUAL primary key (`PAGINATION_KEYS` map; **not** a blanket `.order("id")`
> — `pitch_log_*_totals` and `player_season_*` have no `id` column) and throws for any unregistered table;
> (b) the Stuff+ weight moved off legacy `pitcher_stuff_plus_inputs` onto
> `pitch_log_pitcher_totals.stuff_plus_data_pitches` (`dimension_key='all'`), and the silent `.catch(() => [])` is gone.
> Expected prod effect: `ncaa_averages(2026).stuff_plus` 101.8341 → **~102.33**. Full detail + the measured
> staging/prod comparison: step 27 in `PROD_PUSH_STEPS_2026_08_26.md`.

> ⛔ **BLOCKER — `team_season_stats` is absent on prod** (table AND `refresh_team_season_stats`; probed 2026-08-30).
> Blocks F44 and the G46 edge-fn deploy. THREE migrations must be applied, in order: `20260819000000` (create) →
> `20260821010000` (war cols) → `20260819010000` (fn). Copy-pasteable plan + verification query:
> **`PROD_PUSH_STEPS_2026_08_26.md` Phase-A step 10a.** Needs Trevor's explicit "prod, now?".

> 🛑 **G3 / "recompute returners via the edge fn" is DEAD (2026-08-30).** Everything in this doc that tells you to run
> the `recalculate-prediction` returner rebuild — this G4 line, **G3 at the paragraph above**, PART C step 5, and
> **PART E Phase 1/Phase 2 ("RUN RETURNERS ONCE (step 13a) … via the edge fn")** — is SUPERSEDED. See
> `docs/PROD_PUSH_STEPS_2026_08_26.md` step 47 and `PROD_MIGRATIONS_TODO.md:619`. **Returners are rebuilt by the batch
> scripts** (`precompute-returner-pitchers:prod`, `precompute-returner-hitters:prod` — STEPS steps 36–37). The only
> edge fn deployed in this push is `process-precompute-jobs`. ⚠ Stuff+ is NOT a separate rollup bolted after the derive — the derive IS chain step 5, so the chain must complete before compute_scores. North star: fold all into ONE edge fn, autonomous on upload — with Stuff+ as a wired step.

---

## PART H — NEW-TEAM PRECOMPUTE PATH (edge fn) — MUST DEPLOY (2026-08-21)
⚠️ **Do NOT miss this on the prod push.** When a customer team is added, an AFTER INSERT trigger on `customer_teams` enqueues a `precompute_jobs` row → the **`process-precompute-jobs` edge fn** (`runPrecomputeForTeam`) computes that team's transfer projections. This is a SEPARATE path from the batch scripts and had drifted. It was updated (2026-08-21) to mimic the settled transfer logic:
- **Hitter env+** → STORED `ba/obp/iso_plus` (was live `AVG/0.280`).
- **From-team resolution** → id-first via `source_team_id` (hitter + pitcher; was name-only).
- **D1 pitcher eq** → overlays `model_config` `transfer_*` (was hardcoded defaults). Hitter weights + pitcher env+ were already model_config/stored.

**PROD ACTION (Trevor deploys):** redeploy `supabase/functions/process-precompute-jobs` to prod AFTER the prod DB has: (1) Conference Stats `era_plus…hr9_plus` + `ba/obp/iso_plus` populated, (2) model_config `transfer_*`/`t_*` weights stored, **(3) 🛑 ADDED 2026-08-30 — `team_season_stats` EXISTS AND IS POPULATED** (i.e. `refresh_team_season_stats(2026)` has run). The function reads `team_season_stats.faced_htp` / `faced_stuff_plus` at `supabase/functions/process-precompute-jobs/index.ts:1095` and `:1419` for Independent faced-competition. **That table does not exist on prod today** (probe 2026-08-30) — deploy before F44 and Independents silently lose the faced-competition adjustment. Conditions (1) and (2) alone are NOT sufficient. Otherwise a team added on prod gets OLD-logic projections. Pre-existing Deno literal-type warnings are non-blocking. Deploy staging first, add a test team, confirm its projections match the batch.

---
## PART I — SNAPSHOT REFRESH (Step 6) — MUST run on prod after the transfer re-run + protections
After the prod transfer/returner re-run, refresh saved-build + target snapshots (toggle-preserving) or builds show stale numbers. Two-step (prod): `backfill-neutral-snapshot.ts --prod --apply` then `heal-stale-snapshots.ts --prod --apply --yes`. Covers ALL builds incl. default rosters + target_board. **Protections (verified staging 2026-08-21, 40/40, zero cross-team leakage):** selection filters to `customer_team_id null|this-team` BEFORE picking (never another team's precompute), precedence this-team-precomputed → global-regular → bounded fallback; toggles (`production_notes`) untouched; runtime reads RLS program-scoped by `customer_team_id`. Accuracy mandate: every displayed value reads the stored team-scoped snapshot — consistent everywhere.

---
## ★★★★ CRITICAL PROD-PUSH BLOCKER — CONFERENCE STATS PRODUCERS MUST BE CODIFIED (2026-08-21) ★★★★
**DO NOT PUSH TO PROD WITHOUT THIS.** Several `"Conference Stats"` columns that FEED THE TRANSFER PROJECTIONS + team_season_stats + Program Analytics are populated on staging ONLY by **uncommitted hand-run SQL / direct-connection writes**. If we push without codifying committed producers, these columns will be **EMPTY on prod → transfers + HTP + Program Analytics break silently.** Full map: `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.

**Must have a committed, reproducible producer for EACH before prod (verify each runs on prod, in this order):**
1. **Raw rates** (AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9) — ✅ NOW committed (GAP 3, a960334): `scripts/sql/conf_stats_bucketA_assembly.sql` (runnable, idempotent, txn-wrapped; inlines `_team_conf`). Intra-conf (`is_conference_game=true`).
2. **WRC_plus** — ✅ NOW committed: same file (C1 `(0.011+0.691·OBP+0.235·SLG)/0.3782×100`).
3. **Stuff_plus / Overall_Power_Rating / env+** — mostly have producers (V1 cascade / ~~`populate-conference-stats-env-plus.ts`~~ / `compute_conf_pitcher_env_plus.ts`), but reconcile V1↔V2 + the duplicate env+.
   🛑 **NEVER run `populate-conf-stats` (= `scripts/populate-conference-stats-env-plus.ts`) ON PROD — it overwrites the JUCO overlay.** It is listed above only as an inventory of what exists, not as a prod producer. The prod conference-stats producers are exactly: `scripts/sql/conf_stats_bucketA_assembly.sql` (PASTE) → `scripts/compute_conf_pitcher_env_plus.ts --apply` → `scripts/derive_conf_opr_htp.ts --apply`. See `docs/PROD_PUSH_STEPS_2026_08_26.md` step 28.
   🛑 **Run the NJCAA re-tag (STEPS step 29) BEFORE those two `.ts` producers.** Prod has 10 NJCAA district rows still tagged `division='D1'` for season 2026 (probe 2026-08-30), and both scripts filter `.eq("division","D1")` — so running them first writes D1-derived env+/OPR/HTP straight into the JUCO rows.
4. **run_env_factor** (conf park) — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (conf-avg member `rg_factor`).
5. **offensive_power_rating (OPR)** — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (= Overall_Power_Rating).
6. **hitter_talent_plus (HTP)** — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (canonical park-swap, stored + read-only).
**All 6 producers now committed. REMAINING before prod:** (a) staging idempotent re-run of `conf_stats_bucketA_assembly.sql` vs backup `_confstats_backup_preassembly` to confirm the inlined `team_conf` reproduces the original helper (couldn't run 2026-08-21: no staging conn — `supabase --linked` is PROD); (b) reconcile #3 V1↔V2 + dup env+. End state = ONE edge-fn conf-stats-derive step (Track B) running all of it on upload.

---

## ★★★ THE STUFF+ CHAIN — pitch_log lane (the ONLY correct order)
Any Stuff+ step that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. It
revives the latent raw-HB bug (`e5dec2f` removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Never run it for 2026.**

1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?";
   `--target=staging` for staging). Also MATERIALIZES `_reclass_pf` as a by-product — the scorer hard-depends on it.
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves 6-8% of ALL breaking-ball volume Slider→Gyro Slider, so every
   mix-dependent artifact is invalid until regenerated. The deriver ABORTS before writing if the armHB sign check fails.
3. **Score per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   🛑 **MUST READ BEFORE RUNNING THIS STEP:** the version filter is now parameterized (`--class-version=`, defaulting to
   the v2 stamp) — it used to be hard-coded to `v1-anchor-2026-08-17`, which silently matched 0 rows and left NEW LABELS
   + OLD SCORES. This step is idempotent but does **NOT** resume: every attempt costs the FULL runtime (~36 min on
   staging, longer on prod) and a mid-run failure leaves v2 labels + STALE scores. Run it DETACHED with
   `caffeinate -dimsu -w <pid>`. Requires `_reclass_pf` (materialized by step 1).
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
   🛑 **MUST READ BEFORE RUNNING THIS STEP → see "STEP 4 — SOLVED: USE `--direct`" below.** On PROD you MUST run ALL of
   step 4 with `--direct` (the HTTP gateway cuts at ~125s; `vs_top_hitters` needs 253s on staging, longer on prod, and a
   failure HALTS the dimensions after it). Validate by CONTENT + FRESHNESS — never by exit code or row count.
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (its `readAll` pagination is now `.order(PK)`-ed — unordered `.range()` over ~2.5M rows silently dropped/duped).
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave an environment with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`; exact numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.

---

## ★★★ STUFF+ v2 CLASSIFIER — FINAL STATE + CONCLUSIONS (2026-08-30). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**SINGLE SOURCE:** `src/savant/lib/stuffPlusClassifierV2.ts`. `scripts/reclassify_v2.ts` is a VALIDATION HARNESS only —
its duplicate copy of the classifier was DELETED (that duplication is exactly why earlier numbers drifted).

**FINAL ACCURACY — full population, all 4,804 pitchers / 2,000,674 pitches of `_reclass_result`:**
**1,904,808 / 2,000,674 = 95.2% per-pitch · arsenal-mix 95.3% · needs_review 8.1%** (§11.13 — with §4.5 running BEFORE
the step-4 backfill). ⚠ **SUPERSEDED, never quote as current:** 92.6% (measured on the deleted duplicate copy),
94.3% (pre-gyro-fix), 95.1% (§4.5 running after the fold), "~85%" (the abandoned Tier-2 reconstruction), and any
"projected ~95.3-95.4%".

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied **BEFORE the step-4 backfill** (and
   therefore before `tiebreak()`). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero
   fastball/offspeed regression. Ordering is load-bearing and is worth the final +0.1pp over the "after the fold" build.

**TWO NEGATIVE RESULTS — do NOT rebuild these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**★ DECISION — STANDARDIZE ON v2 IN BOTH ENVIRONMENTS (Trevor, FINAL; EXACT_VALUES §11.12).**
The coherence partition (234 pitchers, 1,188 decidable disputes, run after all three fixes) measured that the ANCHOR
wins the disputed residual **55.9 / 44.1**. That measurement STANDS, and its cost is quantified: ≈11,700 pitches ≈
**0.6% of the population**. We pay it, because the anchor has **NO SOURCE CODE** (lost scratchpad) — it can never be
re-run, on new data or on prod — while v2 is committed, versioned, re-runnable, and is what Track B needs on every
ingest, with ONE vocabulary + a `classification_version` stamp in both environments.
→ **DO overwrite staging's `pitch_type_reclassified` with v2.** Any "do NOT overwrite staging's labels" guidance
(including the earlier framing in SOURCE_OF_TRUTH §4 and EXACT_VALUES §11.11) is **REVERSED and obsolete**.
→ **PRESERVE `_reclass_result`** — the sole surviving record of the anchor, and the regression baseline for every
future classifier change.
⚠ Limitation kept on the record: the coherence partition does NOT cover the Gyro↔Slider pair (23,048 pitches, the
largest residual) — centroids were unavailable after the §4.5 fix. Whether the −3 floor over-calls gyro relative to
physical truth is STILL UNMEASURED; do not claim it either way.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 labeled of
~2,575,996, NO `classification_version` stamp, `needs_review` all null) — **v2 has NEVER written to prod**; the prior
prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130 pitches =
29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**), correcting
prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI + an explicit
"prod, now?" and MUST be followed immediately by the rest of the Stuff+ chain.

---

# STAGE 0 — PRE-PROD BLOCKER STATUS (updated 2026-08-30): **1 OPEN, THE REST RESOLVED**
Prod's **DATA is ready** — 100.00% of prod's `is_data=true` rows (~1,906,398) are v2-classifiable, venue corrections
resolve, same games/window as staging. Every blocker was CODE or SCHEMA, and all but one have shipped.

## ⛔ STILL OPEN — the only thing blocking the prod chain
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's query against prod returns
   `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from the
   data-write "prod, now?".** (Reclassification itself is unaffected — `reclassify_prod.ts` doesn't read those columns.)

## ✅ RESOLVED — shipped; do NOT re-raise these as blockers
2. **Scorer version filter — RESOLVED.** It was hard-coded `.eq("classification_version","v1-anchor-2026-08-17")` while
   `reclassify_prod.ts` stamps `v2-ranges-2026-08-28`, so it silently matched 0 rows (new labels + old scores). It is now
   **parameterized (`--class-version=`, defaulting to the v2 stamp)**. *Evidence:* on staging steps 1→3 connected
   end-to-end and scored 2,015,321 rows. (This also supersedes the old checklist item "do NOT loosen the filter".)
3. **`_reclass_pf` producer — RESOLVED.** `reclassify_prod.ts` now materializes it as a by-product of `pfbVelo()`.
   *Evidence:* the staging run materialized **5,364 pitchers**, and step 2 read it back.
4. **`aggregate_pitch_log_dimensions.ts` prod path — RESOLVED.** It now has a prod path + a `--prod` guard, plus the NEW
   `--direct` and `--only=` flags. *Evidence:* `--direct` cleared `vs_top_hitters` on staging in 253.2s.
5. **§4.5 ordering — RESOLVED.** §4.5 runs BEFORE the step-4 backfill; measured **95.2% / 95.3%** (§11.13) — strictly
   better on both metrics than the 95.1% "after the fold" ordering, so there is nothing left to measure or revert.
6. **Ordered pagination — RESOLVED.** `derive_masters_from_pitchlog.ts` `readAll` is ordered, plus two further
   ordered-pagination fixes (`backfill_trackman_pitches_pitching_master.ts`, `compute_conf_pitcher_env_plus.ts`).
7. **Legacy lane gated out of the live prod CSV path — RESOLVED.** `scripts/import-csvs/runner.ts` (= `npm run
   import:prod`, which goes DIRECT to prod) no longer runs the legacy raw-HB lane, and npm `recompute-stuff:prod` /
   `recompute-stuff-scoped:prod` were **DELETED**. A routine TruMedia import can no longer score left-handers backwards.
8. **Ledger entries — RESOLVED.** C20 park_code (2,576,146 = 100%), C21 `is_conference_game` + C22 sequence
   (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql` are all logged in
   `PROD_MIGRATIONS_TODO.md`.
9. **Staging reclassification writer — RESOLVED.** `reclassify_prod.ts --target=staging`, with a double-keyed guard
   (it refuses unless PGURI's project ref matches the named target).

## ⚠ CLAIMS THAT ARE FALSE — audits disproved them; do not treat any of these as live blockers
"A5 aggregator (pitch_log → `pitcher_stuff_plus_inputs`) is missing" · "the baseline deriver is missing" ·
"the live path has a pop/row convention mismatch" · "the v2 reclassification WRITER does not exist" ·
"the classifier is only ~85% and cannot reach its gate". All verified present / correct / superseded.

## OPEN BUT NOT BLOCKING
- **C21/C22 derive-over-copy follow-up.** They were COPIED from staging (`_next_derived.ts`), not derived. Prod must be
  able to DERIVE `park_code` / `is_conference_game` / sequence going forward or **Track B breaks on the next ingest.**
- **Migration `20260829120000_gm_budget_nil_allocation_mode.sql`** — committed, **NOT yet applied to either env.**
- **Row-count populations, pinned so gates are falsifiable** (these are DIFFERENT populations, not a contradiction):
  2,576,230 = prod pitch_log total pre-dedup · 2,576,146 = park_code/is_conf/sequence filled · ~2,176,888 = prod rows
  carrying an OLD CASE label · 2,013,005 = the v2 prod DRY-RUN label count · **prod `is_data=true` ≈ 1,906,398**
  (74.01% of 2,575,996) · staging v2 classified/stamped = 2,015,321.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).

---

# ▶️ STAGING + PROD STATE, AND THE NEXT ACTIONS (2026-08-30)

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = **2,579,655 rows** / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review **8.1%**, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored = 0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **ALL 48 dimensions refreshed** + `populate_hitter_run_values(2026)` ✓. The 3 `vs_top_hitters` aggregations that had failed on the gateway were completed over the DIRECT pg session (`--direct`). Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 ·
4,234 pitchers.** Prod must land within tolerance of this or **ABORT**.

## ⚠ STILL OPEN ON STAGING
- **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY.** Dry run: **0 hitters / 4,675 pitchers** would change
  (of 4,772 above-gate). It has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Review + apply step 5 (Masters) on staging.
2. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
3. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
4. Prod chain: reclassify → baseline → score → aggregate (**`--direct` from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the pitch_log lane.

## ⏱ PROD TIME BUDGET
Staging actuals: step 1 ≈ **75 min** (load + classify + 2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**
→ **staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already
times out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in **ONE sitting** with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split,
because a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (it re-scores everything matching the class version), so any interruption costs the FULL
runtime again. The two-phase fix (score only `stuff_plus IS NULL`, then ALWAYS recenter across the full population) is
worth building BEFORE the prod run — the recenter must see the whole population, which is why a naive resume is wrong.

---

# ✅ STEP 4 (`aggregate_pitch_log_dimensions`) — SOLVED: USE `--direct`. (staging-proven 2026-08-30)
**ROOT CAUSE CONFIRMED, not theorised.** Every aggregation in this script ran through `exec_sql` over the HTTP gateway
(`aggregate_pitch_log_dimensions.ts:1035`), and the gateway cuts the client at ~125s — the work is LOST.
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`, **reproduced EXACTLY twice**
(same dimension, same error, same duration). That query must resolve the top-quartile hitter set (~967 IDs) and filter
~2M pitches against it. Over the **DIRECT pg session the SAME query succeeded in 253.2s** — it simply needs ~2× the
gateway's ceiling; nothing else changed. 47 of 48 dimensions run fine (~60-72s each). ⚠ The script **HALTS** on a
failure, so dimensions 41-48 never ran either — one bad dimension blocked 9.

## THE COMMANDS
Staging (single dimension):
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
**PROD — run the WHOLE of step 4 with `--direct`, not just this dimension:**
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
`vs_top_hitters` already needs 253s on STAGING. Prod is a smaller compute tier with a more throttled disk (expect
~8-10 min for that one dimension) and prod's `exec_sql` has ALREADY been observed timing out on lighter queries →
through the gateway it would fail on prod **100% of the time**, and the halt would block the 8 dimensions after it.
**`--direct` is NOT a staging workaround — it is the REQUIRED path on prod.**

## FLAGS ON `aggregate_pitch_log_dimensions.ts`
- **`--direct`** (new 2026-08-30) — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling)
  instead of `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs the path used.
- **`--only=<keys>`** (new 2026-08-30) — mirrors `--skip=`; runs ONLY the named dimension(s), so one failed dimension can
  be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- **`--skip=<keys>`** (existing) — skip named dimensions.
- **`--prod`** guard + prod path (added at Stage 0).

## ⚠ THE TWO TRAPS — validate by CONTENT and FRESHNESS, never by exit code or row count
- **A failed dimension leaves STALE rows that LOOK populated.** When `vs_top_hitters` failed, `pitch_log_pitcher_totals`
  still SHOWED **5,349 rows** for that `dimension_key` — left over from a PRE-v2 run, computed from OLD labels and OLD
  Stuff+ scores. **A row-count check would have passed.** → After ANY reclassification, verify a dimension by
  FRESHNESS (did *this* run write it?), never by row count.
- **The script EXITS 0 even when a dimension FAILED.** → grep the log for `FAILED` and for the per-dimension `ok`.
  A run was wrongly marked COMPLETE this way on 2026-08-29.

## RESUMABILITY OF THE CHAIN (know what a restart costs)
| step | resumable? | why |
|---|---|---|
| 1 `reclassify_prod.ts` | ✅ FULLY | keyset on PK + `is distinct from` guards + `_reclass_fix` upserted by PK. A re-run skips completed rows. |
| 3 `compute_pitch_log_stuff_plus.ts` | ❌ NO — and it is the costliest to lose | re-scores ALL rows matching the class version instead of filtering `stuff_plus IS NULL`. Every attempt costs the FULL runtime (~36 min staging, longer on prod), and a mid-run failure leaves **v2 labels + STALE scores**. FIX (future): two phases — score only NULLs, then ALWAYS recenter the full population (the recenter must see everything to shift each bucket to mean 100). |
| 4 `aggregate_pitch_log_dimensions.ts` | ⚠ MANUALLY | the 48 dims are independent and `--skip=`/`--only=` exist, but you must pass the completed keys BY HAND. FIX (future): auto-skip dims already written for this run-generation. |

## ⚠ ENVIRONMENTAL FAILURES — do not confuse them with the gateway timeout
Three failures the same night were the LOCAL MACHINE sleeping / dropping its connection, NOT script defects:
staging insert `TypeError: fetch failed` · STEP 3 scoring died at 1,665,000/2,015,321 (~83%) with `read ECONNRESET` ·
STEP 4 first run died at 13/48, second at 39/48.
**Distinguishing symptom:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters` failure died
at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED and let them take however long they need,** with
`caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not add
aggressive retry loops.

---

## 🏆 PHASE-H CLEANUP — WHAT MUST NEVER BE DROPPED
Phase H lists the Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these — plus `team_war_snapshots`:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Now that we standardize on v2, this is the SOLE way to ever measure
  against the old process — the regression baseline for every future classifier change.
- **`_reclass_map` (37,101 rows)** — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- **`_reclass_pf` (4,804 rows)** — per-pitcher primary-FB velo (the v2 staging run materialized 5,364 rows of it).
- **`team_war_snapshots`** — holds prod's irreplaceable 2025 champions (309 rows). NEVER drop.
Safe to drop: **`_reclass_fix`** (transient writer staging table only).

---
# ✅ MANDATORY PHASE-GATE CHECK — "column exists" ≠ "column is populated" (added 2026-08-30)
The 2026-08-30 audit measured that A8/A9-era columns **EXIST** on prod. It did NOT measure whether their producers
actually FILL them. Those are different failures and only the second one is silent.
**RULE: after EVERY producer step, verify the VALUE landed — not just that the column/table is there.**
A producer that runs, exits 0, and writes nothing looks identical to success. We hit this exact shape twice already:
`vs_top_hitters` left 5,349 STALE rows that made a row-count check PASS, and `compute_pitch_log_stuff_plus` was
filtered to a version string that matched 0 rows while appearing to succeed.

## KNOWN-EMPTY ON PROD TODAY (columns present, values absent) — each must be re-checked AFTER its producer runs
| column / field | table | prod state (2026-08-30) | filled by | GATE: re-check after |
|---|---|---|---|---|
| `hitter_talent_plus` | Conference Stats | **0 / 42** non-null | C28 conf-stats work | C28 |
| `run_env_factor` | Conference Stats | absent values | C28 (`compute_conf_pitcher_env_plus` / `derive_conf_opr_htp`) | C28 |
| `rg_factor_seasonal` (+ the other 9 `*_seasonal`) | Park Factors | **0 / 309** | E2 park-factor producer | E2 |
| `desc_owar` (+ `desc_*` / `total_desc_war`) | Hitter/Pitching Master | **0 / 5,340** | D31 `populate_descriptive_war.mjs` · D32 `_reg` | D31/D32 |
| `preseason_proj_total_war` | (staging-only col, 127 vs 128) | absent on prod | some precompute/snapshot call — NOT a migration | E/F precomputes |
| `trackman_pitches` | Pitching Master | **1,126** vs staging **6,458** | C24 | C24 |
| `stuff_plus` | Pitching Master | 5,251 vs staging 6,011 | C25 `derive_masters_from_pitchlog` | C25 |

## HOW TO GATE (do this at every phase boundary, not at the end)
1. **Count non-null BEFORE and AFTER** the producer. `after > before` and `after ≈ staging's count` — record both numbers.
2. **Compare to STAGING** (the source of truth) for the same season. ⚠ **SEASON KEYS DIFFER BY PURPOSE:
   2026 = completed season / descriptive WAR · 2027 = projections.** A query on the wrong season returns a misleading
   ZERO. (This already produced a false "staging has no WAR data" alarm on 2026-08-30.)
3. **Validate by CONTENT, not exit code** — several producers exit 0 having written nothing.
4. **Verify FRESHNESS, not row count** — a failed step can leave stale rows that a count check passes.
5. If a value is STILL empty after its producer ran, that is a SEPARATE BUG. Stop and diagnose; do NOT proceed to the
   next phase assuming it fills later.

---
# 🛑 STEP 5 / C25 `derive_masters_from_pitchlog.ts` — READ BEFORE `--apply` (2026-08-30)
**This script had NO gate on new-row creation.** `newHitterRows`/`newPitcherRows` were spread into the SAME upsert as
the patches, so `--apply` silently INSERTED invented Master rows and there was no way to take the updates without the
inserts. **FIXED 2026-08-30: new-row creation is now opt-in via `--create-new`, default OFF.**

**WHY inserting them is wrong:** the Masters are the **TruMedia season-stat source of truth**. This script only marries
pitch-log derivations onto EXISTING rows — it explicitly never writes `ERA, IP, G, GS, Role`. A row built from
pitch_log alone is a **HALF-POPULATED player** that downstream treats as real with missing stats. And the candidates
are exactly the pitchers present in pitch_log but ABSENT from the Master — identity-resolution gaps and non-TruMedia
teams — i.e. the rows you least want silently materialized.

## HOW TO RUN IT
```
# review first — dry run is the DEFAULT (no flag)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts
# apply patches to EXISTING rows only (new rows skipped + counted in the output)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts --apply
# ONLY if the new-row list has been reviewed and each row is genuinely wanted:
#   ... --apply --create-new
```
## MANDATORY BEFORE `--apply` ON EITHER ENV
1. **BACK UP BOTH MASTERS FIRST** — there is no other backup and this writes the season-stat tables.
   Staging snapshots taken 2026-08-30: `_hm_prestep5_backup` (30,027 rows) · `_pm_prestep5_backup` (29,239), each a
   full copy indexed on `(source_player_id, "Season")`. **Do the equivalent on PROD before C25.**
2. **Read the diff, not the headline count.** The dry run reports "N would change", but the per-player samples show
   many IDENTICAL before/after values (`9.42/9.42`, `4.81/4.81`) — i.e. no-op rewrites inflate that number. Confirm
   WHICH FIELDS actually move and by how much before accepting it.
3. **Hitters vs pitchers is a useful control.** An earlier dry run showed **0 hitters / 4,675 pitchers** changing —
   consistent with this being Stuff+-driven (the chain just recomputed it) rather than something broader going wrong.
   If HITTERS suddenly start changing too, stop and find out why.
4. **PHASE-GATE after it runs:** Master `stuff_plus` non-null count should rise toward staging's (prod was 5,251 vs
   staging 6,011). "Column exists" ≠ "column populated" — verify the VALUE landed.

---
# ⚠️ `--direct` SILENT HANG — statement_timeout=0 removes the CEILING but also the FAILURE SIGNAL (prod, 2026-08-30)
**What happened:** the prod stage-4 run stalled on `[41/48] vs_top_hitters → pitcher_by_pitch_type` and sat there for
**39 minutes with zero log output**. Diagnosis over a second connection: **NO active query on prod** (`pg_stat_activity`
showed only my own catalog lookup) and **0 ungranted locks** — so the database was doing nothing. The client process was
alive but waiting forever. The direct connection had dropped and the client never learned about it.

**ROOT CAUSE — a gap in the `--direct` fix shipped earlier the same day.** To defeat the HTTP gateway's ~125s cut we set
`statement_timeout = 0` and a very long `query_timeout`. That correctly removes the ceiling that made `vs_top_hitters`
impossible over `exec_sql` — but it ALSO removes the only signal that something died. A dropped pooler connection
therefore presents as an INFINITE HANG instead of an error, and nothing retries because nothing failed.

**FIX TO MAKE (not yet implemented):** on the `--direct` pg client set `keepAlive: true` with a keepalive delay, a
finite `query_timeout` sized to the slowest known dimension with headroom (staging `vs_top_hitters` 254.9s, prod 151.6s
→ e.g. 20-30 min, not 0), and per-dimension progress logging so a stall is visible in the log rather than only in
`pg_stat_activity`. `statement_timeout=0` on the SERVER side is fine; it is the CLIENT-side infinite wait that is wrong.

**HOW TO DETECT A STALL (do this, don't guess):**
1. Compare the log's mtime to now — no output for >2× the slowest dimension = suspect.
2. Query `pg_stat_activity` on a SEPARATE connection: if there is **no active query**, the client is hung, not slow.
3. Check `pg_locks where not granted` — 0 means it is not a lock wait either.
4. Also check for STALE PROCESSES from earlier runs (`pgrep -f aggregate_pitch_log`) — an old staging run was still
   alive and competing for connections.

**RECOVERY (safe — stage 4 is idempotent):** kill the hung + stale processes, then re-run. Prefer re-running the FULL
set on prod rather than cherry-picking with `--only`/`--skip`: dimension rows that already exist may be STALE from the
pre-v2 process, and "rows exist" does NOT mean "rows are fresh". Steps 1-3 are unaffected — do NOT redo them.
**Nothing was corrupted by this stall.**

---
# ✅ C27 → C26 APPLIED TO PROD 2026-08-30 (order is load-bearing — C27 FIRST)
## C27 `computeNcaaAverages` — ✅ APPLIED
`hittersUsed 5,340 · pitchersUsed 5,375 · fieldsWritten 72 · modelConfigRowsWritten 40 · ncaa_averages 2026 = 1 row`
**`p_ncaa_avg_stuff_plus` 101.8341 → 100.0141** · `p_sd_stuff_plus = 5.04577` · `p_ncaa_avg_whiff_pct = 23.3673`.
★ **The Stuff+ mean landing at 100.01 is independent CONFIRMATION that the recenter survived the whole chain**
(score → aggregate → Master rollup). The old 101.83 came from the legacy-weighted lane.
⚠ **C27 MUST PRECEDE C26.** `computeAndStoreScores.ts:206-211,:249` reads baselines from `ncaa_averages` and, for any
MISSING field, falls back to HARDCODED defaults **SILENTLY** (`:212-215`). Wrong order ⇒ quietly wrong power ratings
with no error. This ordering was inverted in the docs and is now corrected everywhere.

## C26 `computeAndStoreScores` (propagate=false) — ✅ APPLIED
`pitchers 8,071 updated, 0 errors · hitters 8,244 updated, 0 errors` · `propagate=false` honored on BOTH sides
(**`player_predictions` untouched** — it is Phase F that repopulates those).
🛑 **BUG FIXED BEFORE RUNNING:** `scripts/_run_store_no_propagate.ts` had **NO env guard** and its banner claimed
"staging" while `--env-file .env.production.local` would happily write PROD. Added the standard double-keyed guard
(URL and `--prod` must AGREE) and made the banner print the resolved env. Refuse path verified:
running against the prod env WITHOUT `--prod` now aborts with `✗ URL is PROD but --prod was not passed`.

## PATTERN WORTH NOTING (3 for 3 on the last three steps)
C24 was sourcing from the LEGACY lane · C26's runner had no guard and a banner that LIED about the target DB · C27 was
documented in the wrong ORDER. **Every one was caught by inspecting the step before running it, not after.** Do not
run a remaining step (C28/C29, D, E, F) without first checking: (1) which LANE does it read from — pitch_log or the
legacy PSP-I? (2) does it have a working double-keyed `--prod` guard? (3) is its position in the sequence right, and
does anything it depends on fall back to defaults SILENTLY?

---
# ✅ C29 NJCAA_D1 RE-TAG — APPLIED TO PROD 2026-08-30 (MUST run BEFORE C28)
**BEFORE:** prod `Conference Stats` 2026 = `D1 40 · D2 2`, of which **10 were `NJCAA%` districts wrongly tagged
`division='D1'`** (Appalachian, East, Mid-South, Midwest, Plains, South Atlantic, South Central, South, Southwest, West).
**APPLIED:** `update "Conference Stats" set division='NJCAA_D1' where season=2026 and division='D1' and
"conference abbreviation" like 'NJCAA%'` → **10 rows re-tagged**.
**AFTER (verified):** `D1 30 · NJCAA_D1 10 · D2 2` — **0 NJCAA rows remain tagged D1**. Matches staging exactly.
⚠ **ORDER IS LOAD-BEARING — C29 BEFORE C28.** Both C28 producers (`compute_conf_pitcher_env_plus`,
`derive_conf_opr_htp`) filter on `division`. Running C28 first writes D1-derived values into the JUCO overlay and
CONTAMINATES the JUCO baselines silently — the same "keep JUCO and true NCAA D1 separate" principle applied in C24.
Also: with 10 JUCO rows counted as D1, the D1 conference SDs were inflated (JUCO FIP runs 6.4–8.0).

---
# 🛑 C28 PRE-FLIGHT — FINDINGS (2026-08-30). RUN NOTHING UNTIL THESE ARE RESOLVED.
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against PROD. Three blockers found.

## ✅ LANE — CLEAN (both producers are on the correct lane)
`compute_conf_pitcher_env_plus.ts` reads `ncaa_averages` (refreshed by C27 ✅) + `"Pitching Master"` D1 WHIP/IP
(refreshed by C26 ✅) + `"Conference Stats"`. `derive_conf_opr_htp.ts` reads `"Park Factors".rg_factor` +
`"Conference Stats"` + `"Teams Table"`. **Neither touches the legacy `pitcher_stuff_plus_inputs`.** Also confirms the
C27-before-C26-before-C28 ordering is right: C28 consumes what both of those produced.

## 🔴 BLOCKER 1 — NEITHER PRODUCER HAS ANY `--prod` GUARD
`grep -c "trbvxuoliwrfowibatkm\|--prod"` = **0** for BOTH `compute_conf_pitcher_env_plus.ts` and
`derive_conf_opr_htp.ts`. `--env-file .env.production.local` writes PROD with **zero opt-in** — the same defect
already fixed in `_run_store_no_propagate.ts` (C26) and the four market scripts. **FIX BEFORE RUNNING:** add the
standard double-keyed guard (URL and `--prod` must AGREE) and verify the refuse path.

## 🔴 BLOCKER 2 — NO BACKUP EXISTS ON PROD, AND THE G-GATE REFERENCE DOES NOT EXIST EITHER
`_confstats_backup` = **ABSENT** on prod · `_confstats_backup_preassembly` = **ABSENT** on prod.
C28 is a DESTRUCTIVE rebuild of the conference baselines that every projection's competition-translation consumes.
**FIX: `create table _confstats_backup as select * from "Conference Stats"` on prod FIRST.**
⚠ The documented **G-GATE** (re-run bucketA on STAGING, diff vs `_confstats_backup_preassembly`, require 0.0000) has
**NEVER been executed** — it was deferred 2026-08-21 ("no staging conn"). The preassembly baseline it compares against
does not exist on prod, so the gate must be run on STAGING, where the artifact belongs.

## 🔴 BLOCKER 3 — `Park Factors.rg_factor_seasonal` IS EMPTY ON PROD (0/309) — SILENT-FALLBACK RISK
| | PROD | STAGING |
|---|---|---|
| Park Factors 2026 rows | 309 | 308 |
| `rg_factor` | **309 ✅** | 308 |
| `rg_factor_seasonal` | **0 ❌** | **308 ✅** |
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which IS populated on prod — so C28 will run. BUT prod is missing
the entire `*_seasonal` set that staging has (its producer, E2 `backfill_park_factors_seasonal.ts`, is hardwired to
STAGING and has never run on prod — audit G13/H4). **Decide BEFORE C28 whether the conference run-environment should
use the seasonal factors** (as staging effectively does downstream) or the flat `rg_factor`. If prod and staging use
different park inputs, their conference HTP/OPR will diverge and the staging-match gate becomes meaningless.

## CURRENT PROD STATE (what C28 is meant to fill)
`Conference Stats` 2026 = **42 rows** (D1 30 · NJCAA_D1 10 · D2 2 after C29) ·
**`hitter_talent_plus` 0/42** · **`run_env_factor` 0/42** ← C28 fills these · `Stuff_plus` **42/42** (pre-existing copy;
audit G14 notes D1 `Stuff_plus` has NO committed producer — confirm what refreshes it or it stays stale while
everything around it is rebuilt).

## ORDERED EXECUTION (only after 1-3 are resolved)
1. Add `--prod` guards to both producers; verify refuse paths.
2. `create table _confstats_backup as select * from "Conference Stats"` on PROD; verify row count = 42.
3. Run the **G-GATE on STAGING** (bucketA re-run vs `_confstats_backup_preassembly`, require diff 0.0000). ABORT if not.
4. Resolve the `rg_factor` vs `rg_factor_seasonal` decision.
5. PROD: **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor — **NEVER `--linked`** (`supabase/config.toml`
   currently names a THIRD project ref `kfkuhdmpchxyffmnowgj`; run `supabase projects list` first).
6. `compute_conf_pitcher_env_plus.ts --apply --prod` → `derive_conf_opr_htp.ts --apply --prod`.
7. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go 0/42 → populated; D1 stays 30 and NJCAA_D1 stays 10;
   conference Stuff+/HTP compare sanely to staging.
⛔ **NEVER run `populate-conf-stats` on prod** — it overwrites the hand-calibrated JUCO overlay. Different script,
confusingly similar name, not part of C28.

---
# ✅ C28 BLOCKERS 1 & 2 CLEARED (2026-08-30) — blocker 3 was MY over-call, corrected
## ✅ FIXED — `--prod` guards added to BOTH producers
`compute_conf_pitcher_env_plus.ts` and `derive_conf_opr_htp.ts` had **NO env guard at all** (grep count 0) —
`--env-file .env.production.local` would have written PROD with zero opt-in. Added the standard double-keyed guard
(URL and `--prod` must AGREE, refuse otherwise, log the resolved env). **Refuse paths VERIFIED on both:**
`✗ URL is PROD but --prod was not passed — refusing.`
## ✅ FIXED — backups created on PROD
`_confstats_backup` = **162 rows (42 for season 2026)** · `_parkfactors_backup` = **615 rows**.
Park Factors was backed up too even though C28 only READS it — E2 rewrites that table later, and a restore point is
cheap now and expensive to lack later.
## ⚠️ CORRECTION — "park factors must be filled first" was WRONG (my over-call)
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which is **309/309 populated on prod**. It NEVER reads
`rg_factor_seasonal`. The SAME script on staging reads the SAME column, so **both environments use identical park
inputs for C28 and there is no divergence** — the staging-match gate remains valid.
The empty `rg_factor_seasonal` (prod 0/309 vs staging 308/308) is **E2's job, later in the sequence**, and its
producer `backfill_park_factors_seasonal.ts` is still hardwired to STAGING (audit G13/H4) — fix that before E2, not
before C28. **C28 is NOT blocked on park factors.**
## STILL OPEN BEFORE C28 RUNS
- **G-GATE on STAGING** — re-run `conf_stats_bucketA_assembly.sql`, diff vs `_confstats_backup_preassembly`, require
  **0.0000**. Never executed (deferred 2026-08-21). The reference table is a STAGING artifact.
- **D1 `Conference Stats.Stuff_plus`** — 42/42 populated on prod but audit G14 says there is NO committed producer.
  Establish what refreshes it, or it stays stale while everything around it is rebuilt.
- ⛔ bucketA must be **PASTED** in the SQL editor, never `--linked` (config.toml names a THIRD ref `kfkuhdmpchxyffmnowgj`).
- ⛔ **NEVER** run `populate-conf-stats` on prod (overwrites the hand-calibrated JUCO overlay).

---
# 🔴→✅ CONFERENCE STUFF+ WAS ON THE LEGACY LANE — FIXED 2026-08-30 (critical for Track B)
## THE FINDING (audit G14 said "no committed producer" — that was WRONG)
`src/savant/lib/conferenceStuffPlusV2.ts` **IS** the producer of `"Conference Stats".Stuff_plus`. But it read
per-pitcher scored rows from **`pitcher_stuff_plus_inputs`** — the **LEGACY CSV lane**. The v2 chain writes Stuff+ to
`pitch_log.stuff_plus` and rolls it up to `"Pitching Master".stuff_plus`; it **NEVER writes PSP-I**, so PSP-I holds
**PRE-v2 scores**. Conference Stuff+ would therefore have been built from stale numbers.
**WHY THIS ONE MATTERS MOST:** Conference Stuff+ IS the competition-translation lever — a player projected INTO a
conference is scored against that conference's Stuff+/HTP. A stale value silently biases **every projection**.
This is the THIRD instance of the same shape (C24 `trackman_pitches`, `computeNcaaAverages` weighting, now this):
**the VALUE moved to the pitch_log lane but a supporting INPUT was left on legacy.**

## THE FIX
Read the rolled-up per-pitcher value and its pitch count straight from `"Pitching Master"`:
`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)` — definition unchanged (pitch-weighted,
full season). Both inputs are **pitch_log-sourced for D1** (C25 writes `stuff_plus`, C24 writes `trackman_pitches`)
and correctly **fall back to the legacy lane for JUCO**, so ONE formula stays right for BOTH divisions without ever
mixing lanes. Filters `stuff_plus IS NOT NULL AND trackman_pitches > 0`.

## VERIFIED ON STAGING (values are sane and the D1/JUCO relationship is correct)
`D1 30 conferences avg 99.16 (range 92.9–107.3)` · `NJCAA_D1 10 avg 96.00 (92.0–100.7)` · `D2 2 avg 93.00`.
D1 centring near 100 with JUCO clearly below it is the expected "conference pitching depth" signal.

## ⚠ GAP FOUND WHILE TESTING — `calculateConferenceStuffPlusV2` IGNORES `dryRun`
It was called with `{ dryRun: true }` and **wrote anyway** ("5. write to Conference Stats"). The option is not
implemented. Benign here (staging needed the refresh and the values are correct) but **there is no way to preview this
producer**. Before running it on PROD: either add real dry-run support, or rely on `_confstats_backup` (already created
on prod, 162 rows / 42 for 2026) as the rollback.
## TRACK B REQUIREMENT
Track B's conference-stats stage must compute Conference Stuff+ from the **pitch_log lane via Pitching Master**, never
from `pitcher_stuff_plus_inputs`, and must keep the D1 / JUCO fallback split intact.

---
# ✅ G-GATE EXECUTED AND PASSED (staging, 2026-08-30) — deferred since 2026-08-21, now done
Method: snapshot `"Conference Stats"` 2026 → `_ggate_before`, re-run `scripts/sql/conf_stats_bucketA_assembly.sql`,
then diff EVERY numeric column joined on `(conference_id, season)`.
**RESULT: 77 numeric columns compared · 0 changed · worst absolute diff 0.000000.**
✅ **The bucketA assembly is IDEMPOTENT** — re-running it does not drift values. Safe to run on prod.
(Reference table `_confstats_backup_preassembly` exists on staging: 162 rows, 42 for 2026.)

# 📊 PROD "Conference Stats" 2026 (D1, 30 rows) — WHAT IS FILLED vs WHAT C28 FILLS
**FILLED (66 cols):** AVG · OBP · ISO · ERA · FIP · WHIP · K9 · BB9 · HR9 · `Overall_Power_Rating` · `WRC_plus` ·
`ba_plus` · `ba_power_rating` · `Stuff_plus` · … (all inputs C28 needs are present)
**EMPTY (13 cols) — exactly C28's outputs, so there is NO partial state:**
`era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` ← `compute_conf_pitcher_env_plus`
`hitter_talent_plus` `run_env_factor` ← `derive_conf_opr_htp`
`OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score` ← bucketA assembly

## 🛑 STALE-VALUE CATCH — `Stuff_plus` IS 30/30 FILLED ON PROD **BUT IT IS PRE-v2**
The Conference Stuff+ lane fix was applied and verified on **STAGING only**. Prod's `"Conference Stats".Stuff_plus`
still holds the value computed BEFORE the v2 chain — a fully-populated column that PASSES any count check while being
stale. Third occurrence today of "looks populated, isn't fresh".
→ **C28 ON PROD NEEDS ONE MORE STEP THAN THE DOCS LIST:** run the FIXED `conferenceStuffPlusV2`
(`Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`) to refresh `Stuff_plus` from the pitch_log
lane, ALONGSIDE the two producers that fill the 13 empty columns. Otherwise the competition-translation lever stays
stale while everything around it is rebuilt.
→ Staging reference after the fix: D1 30 conf avg **99.16** (92.9–107.3) · NJCAA_D1 10 avg **96.00** · D2 2 avg 93.00.

---
# 🧩 C28 BUCKET MAP — WHO WRITES WHAT, AND WHY `Stuff_plus` FELL THROUGH THE GAP (2026-08-30)
`scripts/sql/conf_stats_bucketA_assembly.sql:12` states the split verbatim:
`SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/…)`

| bucket | producer | columns it writes |
|---|---|---|
| **A** | `conf_stats_bucketA_assembly.sql` (PASTE in SQL editor) | `OBP` `ISO` `SLG` `OPS` `obp_plus` `slg_plus` `iso_plus` `WHIP` `FIP` `ERA` + rates + `WRC_plus` |
| **B (pitching env+)** | `compute_conf_pitcher_env_plus.ts` | `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` |
| **B (OPR/HTP)** | `derive_conf_opr_htp.ts` | `run_env_factor` `offensive_power_rating` `hitter_talent_plus` |
| **B (Stuff+)** | ⚠ **`conferenceStuffPlusV2.ts` — a SEPARATE producer, NOT part of the documented C28 steps** | `Stuff_plus` |

## ★ THE GAP, STATED PLAINLY
`Stuff_plus` belongs to **Bucket B** but is written by **NEITHER** bucketA **NOR** `derive_conf_opr_htp`. It has its own
producer that the C28 runbook never listed. So:
**`Stuff_plus` is the ONLY Conference Stats metric that is BOTH (a) stale on prod (pre-v2) AND (b) not refreshed by any
of the three documented C28 steps.** Every other filled column is either rewritten by Bucket A / Bucket B, or is a
source input already refreshed by C24 / C26 / C27.
Because it is 30/30 populated it PASSES every count check while being stale — and it is the competition-translation
lever, so a stale value silently biases EVERY projection of a player INTO a conference.

## ✅ C28 ON PROD — THE CORRECTED FOUR-STEP ORDER (the runbook had three)
0. **Backups already created on prod:** `_confstats_backup` (162 rows / 42 for 2026) · `_parkfactors_backup` (615).
1. **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor. ⛔ **NEVER `--linked`** — `supabase/config.toml`
   names a THIRD project ref (`kfkuhdmpchxyffmnowgj`). Run `supabase projects list` first.
   ✅ **G-GATE PASSED 2026-08-30** — re-run on staging diffed 77 numeric columns: **0 changed, worst 0.000000**, so the
   assembly is IDEMPOTENT and cannot drift prod's values.
2. `npx tsx --env-file=.env.production.local scripts/compute_conf_pitcher_env_plus.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
3. `npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
   Reads `"Park Factors".rg_factor` — **309/309 populated on prod** (it does NOT read `rg_factor_seasonal`, which is
   empty on prod; that is E2's job and NOT a C28 blocker).
4. **★ NEW STEP — refresh `Stuff_plus`:** run the FIXED `conferenceStuffPlusV2`
   (`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)`).
   ⚠ **It IGNORES `dryRun` and writes regardless — no preview exists.** Rollback = `_confstats_backup`.
⛔ **NEVER run `populate-conf-stats` on prod** — different script, confusingly similar name, overwrites the
hand-calibrated JUCO overlay.

## PHASE GATE AFTER C28 (verify VALUES, not just that it ran)
- The 13 previously-EMPTY columns become populated: `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus`
  `hitter_talent_plus` `run_env_factor` `OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score`.
- `Stuff_plus` CHANGES from its stale pre-v2 value (compare BEFORE/AFTER — do not just count non-nulls).
- Division split holds: **D1 = 30 · NJCAA_D1 = 10 · D2 = 2**.
- Staging reference shape after the same fix: D1 avg **99.16** (92.9–107.3) · NJCAA_D1 avg **96.00** · D2 avg 93.00.

---
# ✅ C28 APPLIED TO PROD 2026-08-30 — all four steps, phase gate PASSED
Ran via the DIRECT pg session with the prod ref asserted (equivalent to pasting; **never `--linked`**).
BEFORE snapshot kept as `_c28_before` (alongside `_confstats_backup`).
1. **bucketA assembly** → `OPS` `SLG` `slg_plus` 0/30 → **29/30**
2. **`compute_conf_pitcher_env_plus --apply --prod`** → **30 conf rows**, 0 skipped.
   SANITY (correct direction): SEC ERA 5.82 → era+ **105** · Ivy 5.20 → **117** · HR9 SEC 1.62 → hr9+ **68**
   (SEC allows more HR ⇒ env+ <100) · Ivy 0.70 → **156**.
3. **`derive_conf_opr_htp --apply --prod`** → **30 rows**. e.g. Big 12 HTP 120.4 → **121** · MWC 98.8 → 97.8.
4. **★ `conferenceStuffPlusV2` (FIXED lane)** → **31 rows written**.

## ★ THE `Stuff_plus` CATCH WAS REAL — this is why step 4 exists
**D1 `Stuff_plus`: 101.17 → 99.15, with 30/30 rows CHANGED.** Prod now matches staging's **99.16**.
Following the runbook's three steps would have left it at the stale pre-v2 **101.17** while everything around it was
rebuilt — and a count check would have shown **30/30 populated and PASSED**. Because Conference Stuff+ is the
competition-translation lever, that stale value would have silently biased EVERY projection of a player into a conference.
Division relationship holds and matches staging: **D1 99.15 · NJCAA_D1 96.00 · D2 93.00**.

## PHASE GATE RESULT (D1, all were 0/30 before)
`era_plus 30` `fip_plus 30` `k9_plus 30` `whip_plus 30` `hitter_talent_plus 30` `run_env_factor 30` ✅
`OPS 29` `SLG 29` ⚠ · `pitcher_ev_score 0` ⚠

## ⚠ TWO LOOSE ENDS — NOT resolved, do not assume benign
1. **`OPS`/`SLG`/`slg_plus` = 29/30**, one conference short. Probable cause: a conference with no qualifying hitters,
   but **UNVERIFIED**. Identify the missing conference before trusting conference hitting rates for it.
2. **`pitcher_ev_score` = 0/30 and `pitcher_iz_score` likewise** — listed as bucketA outputs but bucketA did NOT fill
   them. Either they have a different producer or a precondition is unmet. **Find the producer before Phase F**, since
   these feed pitcher-side conference context.

---
# 🔍 C28 LOOSE ENDS — INVESTIGATED AND RESOLVED (2026-08-30)
Method: compare PROD against STAGING (which had already run C28) rather than reasoning from prod alone. This settled
all three in minutes — **always diff the two environments before theorising.**

## 1. ✅ `OPS`/`SLG`/`slg_plus` = 29/30 — EXPECTED, NOT A DEFECT. The missing conference is **Independent**.
```
PROD    — D1 conferences with NULL OPS: Independent
STAGING — D1 conferences with NULL OPS: Independent   (identical)
```
Independents have no conference-mates, so the conference hitting aggregate has nothing to pool. **29/30 is CORRECT on
both environments** — do NOT "fix" this. (Consistent with the existing rule that Independents are handled by
faced-competition Stuff+/HTP rather than conference pooling.)

## 2. ✅ `pitcher_ev_score` / `pitcher_iz_score` = 0/30 — NOT deprecated, NOT a prod gap. **Their producer has never run.**
Empty on **BOTH** prod and staging, so it is not something C28 broke. ⚠ I nearly recorded them as dead columns
superseded by `pitcher_ev90_score` / `pitcher_iz_whiff_score` — **that was WRONG.**
**They have a real producer: `src/savant/lib/conferenceScoutingAverages.ts`**, which WRITES them at `:453` / `:455`
(`pitcher_ev_score: round1(psEV)`, `pitcher_iz_score: round1(psIZ)`) and reads them back at `:520-522`.
→ **ACTION: run `conferenceScoutingAverages` for 2026 to fill them.** It has never been run for this season on either
environment. Pitcher EV mirrors hitter EV and is expected to be populated.

## 3. ★ PROD IS NOW AHEAD OF STAGING on the raw conference pitcher metrics
| column | PROD | STAGING |
|---|---|---|
| `pitcher_ev90` | **30/30** | 0/30 |
| `pitcher_exit_velo` | **30/30** | 0/30 |
| `pitcher_in_zone_pct` | **30/30** | 0/30 |
| `pitcher_iz_whiff_pct` | **30/30** | 0/30 |
| `pitcher_ev90_score` · `pitcher_iz_whiff_score` | 30/30 | 30/30 |
The C28 run filled these on prod; staging never had them. **CONSEQUENCE: staging is no longer a valid reference for
these columns** — do not treat a prod/staging mismatch here as a prod defect. Staging needs C24/C26/C27/C29 + this C28
pass applied to catch up (it only ever received the Stuff+ chain and the Conference Stuff+ lane fix).

## 🧠 LESSON
Two of the three "problems" were not problems, and the third was nearly mis-diagnosed in the opposite direction
(calling a live-but-unrun column deprecated). **Diff the environments FIRST, then grep for a producer, and only then
conclude.** A column being empty means one of: (a) expected/no data to pool, (b) its producer has not run, or
(c) genuinely dead — and those are indistinguishable from the fill count alone.

---
# ✅ C28b — CONFERENCE SCOUTING AVERAGES RUN (prod, 2026-08-30). `pitcher_ev_score` 0/30 → 30/30
**WHY:** `pitcher_ev_score` / `pitcher_iz_score` were 0/30 on **BOTH** prod and staging. They are **NOT deprecated** —
`src/savant/lib/conferenceScoutingAverages.ts` writes them at `:453` / `:455` and reads them at `:520-522`. The
producer had simply **never been run for 2026 on either environment**.
**NEW RUNNER:** `scripts/run_conference_scouting_averages.ts` — the library function had no env guard and no runner
existed, so the runner carries the standard double-keyed guard (URL and `--prod` must AGREE). Refuse path verified:
`✗ URL is PROD but --prod was not passed — refusing.`
**PRE-FLIGHT (all five, before running):** LANE ✅ reads `ncaa_averages` (C27) + the Masters (C25/C26), no legacy PSP-I ·
PAGINATION ✅ `fetchAll` already orders by `source_player_id` · ORDER ✅ needs `ncaa_averages`, C27 done · SILENT
FALLBACK ✅ **none** — it errors explicitly ("run Compute NCAA Averages first") if baselines are missing ·
BACKUP ✅ `_confstats_backup` (162 rows) + `_c28_before`.
**RESULT ON PROD (verified in the DB, not from the log):** `pitcher_ev_score` **30/30, avg 53.22** ·
`pitcher_iz_score` **30/30**.
⚠ **The console printed `conferences computed: 0` while successfully writing 30 rows** — my runner reads the wrong
field off the report object. Harmless, but a reminder of the standing rule: **verify in the database, never from the
log line.** (Fix the field name if this runner is reused.)
⬜ **STAGING still has these at 0/30** — run the same command there (without `--prod`) when catching staging up.

---
# 🗺️ PHASE D (dWAR / bsrWAR) — INVESTIGATION + PLAN (2026-08-30). Read before running anything.
Phase D is **entirely a season-2026 (descriptive) operation** and is **INDEPENDENT of Phases C, E and F** — D31/D32
take their constants from LOCAL JSON fixtures (`RPW 13.1`, E2T, replacement RA9, wOBA weights), NOT from `model_config`
/ `ncaa_averages` / `Conference Stats`. Nothing Phase C produced is an input here. It can run now.

## 🛑 THE ONE HARD BLOCKER — `team_war_snapshots.team_drs` DOES NOT EXIST ON PROD
`populate_descriptive_war.mjs:76` reads `team_war_snapshots(source_team_id, team_drs)`; the error branch at `:65` is
`process.exit(1)`. **D31 dies before writing a single row** (no partial-write risk, but it will not run).
**THE FIX ALREADY EXISTS AND IS NOT A MIGRATION:** `scripts/sql/team_drs_store.sql` — it lives in `scripts/sql/`, NOT in
`supabase/migrations/`, which is exactly why staging got it (2026-08-09) and prod never did. `PROD_MIGRATIONS_TODO.md:234`
records it as "APPLIED STAGING … PROD pending."
**VERIFIED it lands cleanly on prod:** 308 hardcoded `(source_team_id, drs)` values, **sum = −0.007** (correctly centered) ·
**308/308 match prod `team_war_snapshots` season 2026** (prod has 466 rows; the 158 non-D1 correctly stay NULL) ·
**5,375/5,375** prod D1 pitchers with IP>0 resolve `TeamID → Teams Table.source_id → team_drs` (full coverage, zero
fallthrough to `drs_behind = 0`). `:2` is `add column if not exists` → idempotent.
⚠ **DO NOT source these values from staging** — staging's `team_war_snapshots.team_drs` is now **0/308 non-null** (the
table was rebuilt after the 2026-08-09 populate). `scripts/sql/team_drs_store.sql` is the ONLY surviving source of truth.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` 31,467 vs staging 15,561 resolves better). **D30 is a no-op re-run — dry-run to confirm, then skip.**
- **All 23 Master target columns EXIST on prod** (`woba, wraa, desc_owar, d_war, bsr_war, total_desc_war` + `_reg`
  variants; `desc_ra9, desc_fip_ra9, drs_behind, desc_pwar, total_desc_war` + `_reg`). **No Master DDL needed.** All are
  currently 0-populated on prod — that is what Phase D fills.
- All input CSVs/JSON exist on this machine. ⚠ **They are NOT in git** (`scripts/drs/.gitignore` ignores `output/`;
  `docs/drs-reference/.gitignore` ignores `*.csv`) — **Phase D can only be run from this machine.**
- Run from the **repo root** (`node scripts/drs/populate_descriptive_war.mjs`), never `cd scripts/drs` — the scripts mix
  `output/…`, `scripts/drs/output/…` and `docs/drs-reference/…` relative paths.

## ⚠ FIX BEFORE RUNNING
1. **D31 sort key is under-specified.** `populate_descriptive_war.mjs:62` maps `player_season_defense → "player_id"`, but
   `player_id` is NOT unique there (**9,268 distinct over 13,454 rows**) so ties can shuffle across the 14 page
   boundaries. Real PK is `(player_id, season, position)`. Mirror `src/lib/computeNcaaAverages.ts:184-185` exactly.
   (The 2026-08-30 fix got the hard-error half right — neither table has an `id` column — but left the tie half open.)
   Impact is second-order: a handful of wrong `d_war` values, not a hard failure.
2. **🛑 KILL `scripts/load-drs-wsb-prod.ts`** — a STALE DUPLICATE of the loader that never received commit `af89611`'s
   ordered-pagination fix (`:38` is still bare `.range()`), has **no `--dry-run`**, and is named for prod. It sits one
   tab-completion from the correct script. Delete it or reduce it to a shim.

## ▶️ ORDERED SEQUENCE
```
D29b (NEW)  PASTE scripts/sql/team_drs_store.sql in the Supabase SQL editor. ⛔ never `--linked`
            (config.toml still names a third ref kfkuhdmpchxyffmnowgj). Idempotent.
            GATE: select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;   EXPECT 308 and ~-0.01
            Then tick PROD_MIGRATIONS_TODO.md:234.
D30         npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
            EXPECT "13454 would upsert, 11 unresolved" / "10432 would upsert, 30 unresolved" → then SKIP the apply.
            ⛔ NEVER scripts/load-drs-wsb-prod.ts
D31         node scripts/drs/populate_descriptive_war.mjs --prod          (dry-run first, from repo root)
            GATE vs staging (2026 D1): desc_owar mean 0.3456 · d_war mean 0.0103 · bsr_war mean 0.0000 ·
            total_desc_war mean 0.3559 · HITTERS ~5,340 · PITCHERS ~5,375.
            ★ Confirm `drs_behind` is NOT all-zero in the SPOT block — all-zero means D29b did not take.
            then: node scripts/drs/populate_descriptive_war.mjs --prod --commit
            ⚠ ~10,715 individual PostgREST UPDATEs at pool 24 (:151-163), several minutes, NO transaction.
              A mid-run failure leaves a partial write; re-running is safe (pure recompute keyed by source_player_id+Season).
D32         node scripts/drs/populate_descriptive_war_reg.mjs --prod      (dry-run, then --commit)
            ★★ HARD-ORDER: MUST follow D31's commit. It reads `Pitching Master.drs_behind` (:79) and `num(NULL) → 0`,
               so running it early produces WRONG desc_ra9_reg / desc_pwar_reg with **NO error**. Verify
               drs_behind = 5,375/5,375 non-null on prod FIRST.
            GATE: staging has 5,322/5,343 hitter _reg and 5,372/5,377 pitcher _reg — the ~20 shortfall is players absent
            from hitter_accrued.csv, expected.
D33         ⛔ SKIP. CSV-only output (`:36` writes team_drs.csv), no DB write anywhere, and `:13` hardcodes
            `./.env.local`. D29b already supplies the values it would derive. If ever run it must be LAST (it reads the
            Masters that D31/D32 write) — the checklist ordering that puts it before D30/D31 is WRONG.
D34         VERIFY on prod, 2026, division='D1':
            d_war / bsr_war / desc_owar / total_desc_war = 5,340 non-null each ·
            desc_pwar / desc_ra9 / drs_behind = 5,375 each · avg(d_war) ≈ 0.010 · avg(bsr_war) ≈ 0.000 ·
            avg(desc_owar) ≈ 0.346 · max|total_desc_war − (desc_owar+d_war+bsr_war)| ≤ 0.002 ·
            drs_behind range ≈ −5.24 … 6.48 with ~11 exact zeros.
```

## 📄 DOC CORRECTIONS FROM THIS INVESTIGATION
- **F39 is described wrongly in the runbook.** `refresh_composite_war()` on prod (read via `pg_get_functiondef`) updates
  **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the Masters**. So it does NOT overlap D31's
  Master writes, and the accidental 2026-08-30 invocation left `Hitter Master.d_war` at 0/5,340 (confirmed).
- **`regular_season_pa` / `regular_season_ip` are 0-populated on prod** (staging 5,339/5,343 and 5,374/5,377). NOT a
  Phase D blocker — D32 selects but never reads them (its reg counts come from CSVs). Producer is
  `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026"). Will bite a later phase.
- **`team_season_stats` is 0 rows on prod** (staging 308 for 2026). Filled in Phase F by `refresh_team_season_stats(2026)`,
  whose step 6 carries `team_drs` across from `team_war_snapshots` — so D29b also unblocks that later carry.

---
# 🔁 DOC-vs-REALITY SWEEP (2026-08-30, late) — re-probed prod directly. FOUR 🛑 BLOCKERS ARE STALE, ONE IS NEW.
Method: direct pg session against the prod ref + `grep -c` on each named script. **Verified, not asserted.**
Every 🛑 in these docs was re-checked against the live database and the current file, because several were written
BEFORE the fixes that resolved them and a stale blocker is as expensive as a missed one.

## ✅ STALE — these 🛑 blockers are RESOLVED. Do not re-do this work.
| doc claim | reality on 2026-08-30 |
|---|---|
| **F44 / step 10a: "`team_season_stats` does not exist, 3 migrations unapplied, CANNOT RUN TODAY"** | **table EXISTS + `refresh_team_season_stats` fn EXISTS** (`pg_proc` = 1). The 3 migrations were applied in DEPENDENCY order as Phase-C prereqs. Table is **0 rows** — that is F44's job, not a blocker. **F44 is RUNNABLE.** |
| **G46: "blocked — `team_season_stats` missing"** | Same. The gate is now only "F44 has RUN and populated it", not "the table must be created". |
| **F42: "`resync-build-snapshot-markets.ts:17` is hardcoded to `.env.local`, will silently write STAGING"** | **FIXED.** The file header now documents the old defect and it is env-driven (`process.env` first, env-file fallback) with a **double-keyed guard**. **F42's first half is runnable.** |
| **F41: "`rebake-twp-markets.ts` / `fix-returner-twp-hitter-market.ts` have no `--prod` flag and no ref assert"** | **FIXED.** Both now `grep -c trbvxuoliwrfowibatkm` = 1 with `--prod` handling. Still invoke them directly (not npm scripts) — that half of the note stands. |
| **D30: "`load-drs-wsb-staging.ts:53` unordered `.range()` over `players`"** | **FIXED** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending. The comment documenting why is in the file. |

## 🔴 NEW BLOCKER — `scripts/run-twp-recompute.ts` (step E35) HAS NO ENV GUARD AT ALL
`grep -c 'trbvxuoliwrfowibatkm'` = **0** and `grep -c -- '--prod'` = **0**. E35 is the **FIRST** step of Phase E and it
**sets `is_twp` + primary `position` on `players`** — a write to the identity table that every downstream precompute
keys off. `--env-file .env.production.local` writes PROD with **zero opt-in**, and passing `--prod` does nothing.
This is the SAME defect already fixed in `_run_store_no_propagate.ts` (C26), both C28 producers, and the four market
scripts — **the fifth instance of it.** ⚠ Prod `is_twp` = **137/31,467** vs staging's 253, so this step genuinely has
work to do on prod and WILL be run. **Add the standard double-keyed guard and verify the refuse path before Phase E.**

## 🔴 STILL OPEN — `backfill_park_factors_seasonal.ts` (E2) is unguarded AND staging-hardwired
`grep -c` = **0 / 0**. Prod `"Park Factors"` 2026 = **309 rows · `rg_factor` 309/309 ✅ · `rg_factor_seasonal` 0/309 ❌**
(staging 308/308). Confirms audit G13/H4: the producer has never run on prod. **Not a C28 blocker** (C28 reads
`rg_factor`, which is full) — but it must be guarded + re-pointed before E2, and F44/G46 consume park-derived values.

## 📊 PROD STATE PROBED DIRECTLY (2026-08-30) — the numbers Phase D/E/F start from
```
team_season_stats           EXISTS, 0 rows        refresh_team_season_stats()  EXISTS
team_war_snapshots.team_drs COLUMN ABSENT  ← the Phase D hard blocker (D29b)
"Park Factors" 2026         309 · rg_factor 309 ✅ · rg_factor_seasonal 0 ❌
"Hitter Master"   2026 D1   5,340 · d_war 0 · desc_owar 0 · total_desc_war 0   ← Phase D fills
"Pitching Master" 2026 D1   5,375 · drs_behind 0 · desc_pwar 0                 ← Phase D fills
players                     31,467 · is_twp 137   (staging 253)                ← E35 fills
customer_teams active       14  ✅ (NOT 18 — that is a staging number)
player_predictions 2027     200,754 rows (pre-existing; Phase E regenerates)
```
★ **`Hitter Master.d_war` = 0/5,340 is independent CONFIRMATION that the accidental `refresh_composite_war()` did NOT
touch the Masters** — it writes `player_predictions`. The runbook's F39 description is wrong; see the Phase D block.

## 🧠 LESSON — RE-PROBE BEFORE TRUSTING A 🛑 YOU WROTE YESTERDAY
Four blockers were already fixed and one brand-new one was sitting unflagged in the very next phase. A 🛑 records the
state at the moment it was written; it is **not** a live indicator. **Re-run the check, then act.** The 5-question
pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has now found a real defect before **every** step it has
been applied to — C24 (legacy lane) · C26 (no guard, lying banner) · C27 (wrong order) · C28 (no guards on either
producer, no backup) · C28b (no runner at all) · Conference Stuff+ (legacy lane) · D31 (sort key) · **E35 (no guard)**.
