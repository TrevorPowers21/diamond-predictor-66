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

---

## PART G — PIPELINE PIVOT (Steps 2–4, toward ONE edge fn). CODE ships with branch; the RUNS below execute on prod after the code merges.

**G1. `computeNcaaAverages.ts` (Step 2a) — CODE.** commit `f3c231d`. (a) `pitcher_exit_velo`/`pitcher_ev90` (mean+sd) pinned = hitter `exit_velo`/`ev90` 1-for-1 (was NULL / wrong `90th_vel`=fastball-velo). (b) `pitcher_in_zone_pct` added to map. (c) **Dual-writes mean+SD to BOTH `ncaa_averages` AND `model_config`** (`buildModelConfigRows`, keys `p_ncaa_avg_*`/`p_sd_*`/`r_*`/`t_*`). **PROD RUN:** re-run `computeAndStoreNcaaAverages(season)` on prod after Masters are pitch-log-fed → refreshes both stores. `wrc_sd` intentionally null.

**G2. `createPredictionsFromMaster.ts` (Step 3) — CODE.** commit `1ff06b7`. Writes per-stat `from_avg_plus/from_obp_plus/from_slg_plus` (= `ba/obp/iso_power_rating`) on insert+update; guard also fires on `from_obp_plus==null` so existing rows backfill. **PROD RUN:** re-run create_predictions so `from_obp_plus` (returner SD-blend input) populates.

**G3. Edge-fn returner rebuild (Step 4) — CODE, NOT YET BUILT.** Rewrite `recalculate-prediction` `recalc()` to the SD-blend (per-stat `from_obp_plus`, `+0.011` wRC intercept, tiered damp), READ `model_config` `r_*`/`p_sd_*` (fix the `model_type='returner'`→0-rows + bare-key bugs), delete dead `bulkRecalc`/`fetchAllPredictionsForReturnerMode`. **PROD RUN:** recompute returners (H+P) once after code merges. Transfer deferred.

**G0. Stuff+ rollup → `Pitching Master.stuff_plus` (MUST precede compute_scores).** Stuff+ is an INPUT to the pitcher power ratings (k9⁺/era⁺/whip⁺). Pipeline: `runBreakingBallReclassification` → `runStuffPlusPipeline` (per-pitch Stuff+) → `rollupStuffPlusToMaster` (`scripts/recompute-stuff-plus.ts`). Stuff+ was fully audited + is current (v1-anchor 2026-08-17); the Step-1 derive already set `Master.stuff_plus` from the totals' pitch-weighted per-pitch Stuff+ (verified matches to 0.01). **For the unified process this rollup must be an explicit step before compute_scores** — currently satisfied because the derive populated it. If pitch data/baselines change, run the full recompute first.

**G4. Execution order (prod, pipeline pivot):** F1/F2 (ip col + constraints) → F3 (derive → Masters, incl. stuff_plus) → **G0 Stuff+ rollup (if not current)** → G1 (ncaa_averages+model_config) → compute_scores → G2 (create_predictions) → G3 (recompute returners). North star: fold all into ONE edge fn, autonomous on upload — with Stuff+ as a wired step.

---

## PART H — NEW-TEAM PRECOMPUTE PATH (edge fn) — MUST DEPLOY (2026-08-21)
⚠️ **Do NOT miss this on the prod push.** When a customer team is added, an AFTER INSERT trigger on `customer_teams` enqueues a `precompute_jobs` row → the **`process-precompute-jobs` edge fn** (`runPrecomputeForTeam`) computes that team's transfer projections. This is a SEPARATE path from the batch scripts and had drifted. It was updated (2026-08-21) to mimic the settled transfer logic:
- **Hitter env+** → STORED `ba/obp/iso_plus` (was live `AVG/0.280`).
- **From-team resolution** → id-first via `source_team_id` (hitter + pitcher; was name-only).
- **D1 pitcher eq** → overlays `model_config` `transfer_*` (was hardcoded defaults). Hitter weights + pitcher env+ were already model_config/stored.

**PROD ACTION (Trevor deploys):** redeploy `supabase/functions/process-precompute-jobs` to prod AFTER the prod DB has: (1) Conference Stats `era_plus…hr9_plus` + `ba/obp/iso_plus` populated, (2) model_config `transfer_*`/`t_*` weights stored. Otherwise a team added on prod gets OLD-logic projections. Pre-existing Deno literal-type warnings are non-blocking. Deploy staging first, add a test team, confirm its projections match the batch.

---
## PART I — SNAPSHOT REFRESH (Step 6) — MUST run on prod after the transfer re-run + protections
After the prod transfer/returner re-run, refresh saved-build + target snapshots (toggle-preserving) or builds show stale numbers. Two-step (prod): `backfill-neutral-snapshot.ts --prod --apply` then `heal-stale-snapshots.ts --prod --apply --yes`. Covers ALL builds incl. default rosters + target_board. **Protections (verified staging 2026-08-21, 40/40, zero cross-team leakage):** selection filters to `customer_team_id null|this-team` BEFORE picking (never another team's precompute), precedence this-team-precomputed → global-regular → bounded fallback; toggles (`production_notes`) untouched; runtime reads RLS program-scoped by `customer_team_id`. Accuracy mandate: every displayed value reads the stored team-scoped snapshot — consistent everywhere.

---
## ★★★★ CRITICAL PROD-PUSH BLOCKER — CONFERENCE STATS PRODUCERS MUST BE CODIFIED (2026-08-21) ★★★★
**DO NOT PUSH TO PROD WITHOUT THIS.** Several `"Conference Stats"` columns that FEED THE TRANSFER PROJECTIONS + team_season_stats + Program Analytics are populated on staging ONLY by **uncommitted hand-run SQL / direct-connection writes**. If we push without codifying committed producers, these columns will be **EMPTY on prod → transfers + HTP + Program Analytics break silently.** Full map: `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.

**Must have a committed, reproducible producer for EACH before prod (verify each runs on prod, in this order):**
1. **Raw rates** (AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9) — ✅ NOW committed (GAP 3, a960334): `scripts/sql/conf_stats_bucketA_assembly.sql` (runnable, idempotent, txn-wrapped; inlines `_team_conf`). Intra-conf (`is_conference_game=true`).
2. **WRC_plus** — ✅ NOW committed: same file (C1 `(0.011+0.691·OBP+0.235·SLG)/0.3782×100`).
3. **Stuff_plus / Overall_Power_Rating / env+** — mostly have producers (V1 cascade / `populate-conference-stats-env-plus.ts` / `compute_conf_pitcher_env_plus.ts`), but reconcile V1↔V2 + the duplicate env+.
4. **run_env_factor** (conf park) — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (conf-avg member `rg_factor`).
5. **offensive_power_rating (OPR)** — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (= Overall_Power_Rating).
6. **hitter_talent_plus (HTP)** — ✅ NOW committed: `scripts/derive_conf_opr_htp.ts` (canonical park-swap, stored + read-only).
**All 6 producers now committed. REMAINING before prod:** (a) staging idempotent re-run of `conf_stats_bucketA_assembly.sql` vs backup `_confstats_backup_preassembly` to confirm the inlined `team_conf` reproduces the original helper (couldn't run 2026-08-21: no staging conn — `supabase --linked` is PROD); (b) reconcile #3 V1↔V2 + dup env+. End state = ONE edge-fn conf-stats-derive step (Track B) running all of it on upload.

---
## ★★★ CORRECTED STUFF+ CHAIN (2026-08-29) — USE THIS, NOT THE LEGACY STEPS BELOW/ABOVE
Any Stuff+ step in this document that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. Running it
revives the latent raw-HB bug (e5dec2f removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Do not run those steps.**

**THE CORRECT ORDER (pitch_log lane — the live source of truth):**
1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?")
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only)
3. **Score per pitch** → `pitch_log.stuff_plus`  — `scripts/compute_pitch_log_stuff_plus.ts`
   🛑 **MUST READ BEFORE RUNNING THIS STEP:** the version filter is now parameterized (`--class-version=`, defaults to the v2 stamp) — it was hard-coded to `v1-anchor-2026-08-17`, which silently matched 0 rows and left NEW LABELS + OLD SCORES. This step is idempotent but does **NOT** resume: every attempt costs the FULL runtime (~36 min staging, longer on prod) and a mid-run failure leaves labels-without-scores. Run it DETACHED with `caffeinate -dimsu -w <pid>`. Requires `_reclass_pf` (materialized by step 1).
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
   🛑 **MUST READ BEFORE RUNNING THIS STEP → see "SOLVED — STEP 4 `vs_top_hitters`: USE `--direct`" at the end of this doc.** On PROD you MUST pass `--direct` (gateway cuts at ~125s; this dimension needs 253s on staging, longer on prod, and a failure HALTS the 8 dimensions after it). Verify by FRESHNESS not row count — a failed dimension leaves stale rows that look populated. The script EXITS 0 even when a dimension FAILED.
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (⚠ add `.order(PK)` to its `readAll` pagination first — unordered `.range()` over ~2.5M rows silently drops/dupes)
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave prod with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`.

---
## ★★★ STUFF+ v2 CLASSIFIER — CURRENT STATE + CONCLUSIONS (2026-08-29). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**ACCURACY vs the anchor ground truth (`_reclass_result`, all 4,804 pitchers / 2,000,674 pitches):**
`1,885,862 / 2,000,674 = 94.3% per-pitch` · arsenal-mix 94.3% · needs_review 8.1% — **+ the §4.5 gyro fix (measured
+0.96pp / +1.24pp on two disjoint samples) → projected ~95.3-95.4%.** Supersedes the stale 92.6%, which predated the
fixes AND was measured against a DUPLICATE copy of the classifier that has since been deleted.

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied BEFORE `tiebreak()` (ordering is worth
   ~+0.3pp). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero fastball/offspeed regression.

**TWO NEGATIVE RESULTS — do NOT redo these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the PREVIOUS classifier's output (a lost scratchpad
implementation), not truth. The residual ~4.7% mixes (a) v2 wrong, (b) **v2 RIGHT and the anchor wrong**, (c) coin-flips.
Partition it with `scripts/v2_coherence_test.ts` before treating any of it as error. If v2 wins a meaningful share, the
"do NOT overwrite staging's labels" guidance REVERSES.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 rows, NO
`classification_version` stamp, `needs_review` all null, no `_reclass_fix` table) — **v2 has NEVER written to prod**; the
prior prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130
pitches = 29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**),
correcting prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI +
an explicit "prod, now?" and MUST be followed immediately by the Stuff+ recompute chain.

---
# 🔴 STAGE 0 — BLOCKERS FOUND BY AUDIT 2026-08-29. NOTHING RUNS ON PROD UNTIL THESE ARE FIXED.
Two independent read-only audits (docs/state + prod data). **Prod's DATA is ready — 100.00% of prod's `is_data=true`
rows (~1,906,398) are v2-classifiable, venue corrections resolve, same games/window as staging. Every blocker below is
CODE or SCHEMA.** Any one stops the chain; #2 is the dangerous one because it fails SILENTLY.

## THE FOUR HARD BLOCKERS
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's exact query (`compute_pitch_log_stuff_plus.ts:172-179`)
   against prod returns: `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from
   the data-write "prod, now?".** (Reclassification itself is unaffected: `reclassify_prod.ts:38-39` doesn't read those columns.)
2. **⚠ SILENT-CORRUPTION RISK — scorer is hard-filtered to the OLD version string.**
   `compute_pitch_log_stuff_plus.ts:151` and `:176` both `.eq("classification_version", "v1-anchor-2026-08-17")`, but
   `reclassify_prod.ts:19` stamps `v2-ranges-2026-08-28`. **Step 1 and step 3 of the corrected chain DO NOT CONNECT.**
   Unfixed, the scorer matches 0 rows, no-ops, and leaves prod with NEW LABELS + OLD `stuff_plus` — the one invariant
   every doc says must never happen — while appearing to succeed. FIX: parameterize (`--class-version`, default v2).
   (This supersedes checklist G7's "do NOT loosen filter" guidance, which assumed the anchor version.)
3. **`_reclass_pf` DOES NOT EXIST ON PROD** (staging: 4,804 rows) and has **NO producer anywhere in the repo** — every
   reference is a READ. `compute_pitch_log_stuff_plus.ts:132-135` does `process.exit(1)` if it can't load it, so prod
   scoring aborts immediately. FIX: have `reclassify_prod.ts` materialize it as a by-product of its existing
   `pfbVelo()` (`:28`), or inline the same computation into the scorer.
4. **`aggregate_pitch_log_dimensions.ts` has NO prod path** — `:957` reads `process.env.VITE_SUPABASE_URL` only, no
   `SUPABASE_URL` fallback and no `--prod` guard. It is step 4 of the chain and also calls `populate_hitter_run_values(2026)`.

## ALSO REQUIRED BEFORE THE RUN
5. **Resolve the UNCOMMITTED §4.5 reordering** in `src/savant/lib/stuffPlusClassifierV2.ts`. The working tree moves the
   gyro floor to BEFORE the step-4 backfill (fixes fragmentation: 7%→5% of pitchers, median fringe 2.8%→1.1%), but the
   **confirmed 95.1% was measured on the COMMITTED ordering** (after step 4, before `tiebreak`). Measure or revert —
   it changes labels on 6-8% of breaking-ball volume. ⚠ Trevor's standing caveat: agreement-with-the-anchor is NOT
   accuracy for a rule the anchor never had.
6. **`.order(PK)` on `derive_masters_from_pitchlog.ts:188-201`** (`fetchAll`, unordered `.range()` over ~2.5M rows →
   silent drop/dupe). Precondition for chain step 5. Same fix needed on
   `backfill_trackman_pitches_pitching_master.ts:32-33` and `compute_conf_pitcher_env_plus.ts:13` before C24/C28.
7. **⛔ GATE THE LEGACY LANE OUT OF THE LIVE PROD CSV PATH.** `scripts/import-csvs/runner.ts:442,461` calls
   `runBreakingBallReclassification` + `runStuffPlusPipeline` + `legacy_rollupStuffPlusToMaster`, and that script is
   `npm run import:prod` — which per standing practice goes DIRECT TO PROD. **A routine TruMedia import today runs the
   legacy raw-HB lane and scores left-handers BACKWARDS.** Gate behind `season <= 2025` / `--legacy-stuff`. Also delete
   npm `recompute-stuff:prod` and `recompute-stuff-scoped:prod` (`package.json:21,93`) — one keystroke from a prod legacy write.

## LEDGER + DOC INTEGRITY (fix before an operator follows them literally)
8. **`PROD_MIGRATIONS_TODO.md` is missing entries for work ALREADY DONE on prod:** C20 park_code (2,576,146 = 100%),
   C21 is_conference_game + C22 sequence (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql`.
   The ledger's own rule (`:28-38`) says "if it's not here, it doesn't happen on prod" — an operator would RE-RUN them.
9. **C21/C22 were COPIED from staging, not derived** (`_next_derived.ts`). The logged principle requires prod to DERIVE
   these going forward; that FOLLOW-UP is on no task list, and **Track B breaks on the next ingest without it.**
10. **Stale text still in these docs:** the top correction banner still says "do NOT overwrite staging's labels"
    (REVERSED by EXACT_VALUES §11.12 — we now standardize on v2 in BOTH envs); five docs still print
    "94.3% → projected ~95.3-95.4%" (confirmed number is **95.1%**, §11.10); the BULLETPROOF verdict is still **NO-GO**
    on blockers G2/G3/G5/G6 that are now FALSE or DONE (v2 writer exists; classifier is 95.1% not ~85%; the "A5
    aggregator missing" and "baseline deriver missing" claims were disproven).
11. **Row-count contradiction across docs** — 2,576,230 (total) vs 2,576,146 (filled) vs ~2,176,888 (labeled) vs
    2,013,005 (v2 dry-run labels) are DIFFERENT populations and no doc says so. Pre-register which number each gate
    checks, or the verify step is unfalsifiable. Prod is_data=true ≈ **1,906,398** (74.01% of 2,575,996).

## STILL-MISSING PRODUCER (new obligation created by the §11.12 decision)
12. **No STAGING reclassification writer.** `reclassify_prod.ts:100` hard-aborts unless PGURI is prod
    (`if (!/trbvxuoliwrfowibatkm/.test(uri)) … exit(1)`). §11.12 requires staging to get the SAME full chain, so this
    needs an env-parameterized target. Not listed as a task in any doc before now.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).
⚠ The known prod dup issue (~3,425 dup rows / 29 games) still lives on this table.

---
# 🔴 STEP 4 (aggregate_pitch_log_dimensions) — GATEWAY TIMEOUT ON `vs_top_hitters`. Found on staging 2026-08-29/30.
**EVERY aggregation in this script runs through `exec_sql` over the HTTP gateway** (`aggregate_pitch_log_dimensions.ts:1035`
`await supabase.rpc("exec_sql", { sql })`). The gateway cuts the client at ~125s and the work is LOST.

## The deterministic failure
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`
**Reproduced EXACTLY twice** — same dimension, same error, same 125.3s duration. Not a dropped connection: that query
must resolve the top-quartile hitter set (~967 IDs) and filter ~2M pitches against it, which exceeds the gateway ceiling.
47 of 48 aggregations complete fine (~60-72s each); only this one is structurally too heavy for `exec_sql`.
⚠ **The script HALTS on the failure**, so dimensions 41-48 never ran either — one bad dimension blocks 9.

## WORKAROUND USED ON STAGING (Trevor's call)
1. `--skip=vs_top_hitters` to clear the other 47 (the `--skip` flag exists at `:953-954`, matched at `:1029`).
2. Run `vs_top_hitters` SEPARATELY over the **direct pg session** (`PGURI`) where there is no gateway timeout —
   the same pattern the reclassifier already uses for its big writes.

## ⚠⚠ PROD IMPLICATION — THIS WILL BE WORSE ON PROD, PLAN FOR IT
Prod is on a smaller compute tier with a more throttled disk, and prod's `exec_sql` has ALREADY been observed timing
out on far lighter queries. Do NOT assume the other 47 will clear on prod just because they did on staging.
**Recommended prod approach: run stage 4 over the direct pg session from the start**, not through `exec_sql`.
Budget generously and run it detached/unattended-safe.

## SEPARATE, ENVIRONMENTAL FAILURES SEEN THE SAME NIGHT (do not confuse with the above)
Three earlier failures were the LOCAL MACHINE sleeping / dropping its connection overnight, NOT script defects:
- staging insert during the v2 test: `TypeError: fetch failed`
- STEP 3 scoring died at 1,665,000/2,015,321 (~83%): `read ECONNRESET`
- STEP 4 first run died at 13/48, second reached 39/48
**Symptom that distinguishes them:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters`
failure dies at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED in the background and let them take however long they need,**
with `caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not
add aggressive retry loops.
⚠ STEP 3 (`compute_pitch_log_stuff_plus.ts`) is idempotent but does **NOT** resume — `:185` re-scores ALL rows matching
the class version rather than filtering `stuff_plus IS NULL`, so every attempt costs the FULL runtime (~36 min on
staging). A mid-run failure leaves **v2 labels + STALE scores**, the one state every doc says must never exist.

---
# ▶️ RESUME HERE — STAGING CHAIN 95% DONE (2026-08-30). Read this block first.

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = 2,579,655 rows / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review 8.1%, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored=0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **45 of 48** refreshed + `populate_hitter_run_values(2026)` ✓. Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 · 4,234 pitchers.**
Prod must land within tolerance of this or ABORT.

## ⚠ OUTSTANDING ON STAGING
1. **3 × `vs_top_hitters` aggregations are STALE** — they failed twice (deterministic 125.3s gateway timeout) and were
   skipped on the successful run. ⚠ **`pitch_log_pitcher_totals` SHOWS `vs_top_hitters: 5,349` rows so the table LOOKS
   populated — those rows predate the v2 chain and are computed from OLD labels + OLD scores.** Must be re-run over the
   DIRECT pg session (`PGURI` in `.env.local`), not `exec_sql`.
2. **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY so far.** Dry run: **0 hitters** / **4,675 pitchers** would
   change (of 4,772 above-gate). Has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Run the 3 `vs_top_hitters` aggregations over the direct pg session (also = the PROD recipe for stage 4).
2. Review + apply step 5 (Masters) on staging.
3. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
4. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
5. Prod chain: reclassify → baseline → score → aggregate (**direct session from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the CORRECTED pitch_log lane.

## ⏱ REALISTIC TIME ESTIMATE FOR THE PROD RUN
Staging actuals: step 1 ≈ **75 min** (load+classify+2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**.
**Staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already times
out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in ONE sitting with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split, because
a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (re-scores everything matching the class version), so any interruption costs the FULL
runtime again. Consider building the two-phase fix (score only NULLs → always recenter all) BEFORE the prod run.

---
# ✅ SOLVED — STEP 4 `vs_top_hitters`: USE `--direct`. (staging-proven 2026-08-30)
**Root cause CONFIRMED, not theorised:** the query is not broken, it is simply LONGER than the HTTP gateway allows.
Over `exec_sql` it failed **twice, deterministically, at exactly 125.3s**. Over the DIRECT pg session the SAME query
**succeeded in 253.2s** — i.e. it needs ~2× the gateway's ~125s ceiling. Nothing else changed.

## THE COMMAND (staging)
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
## ⚠⚠ THE COMMAND FOR PROD — RUN THE WHOLE OF STEP 4 WITH `--direct`, NOT JUST THIS DIMENSION
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
**Reasoning:** `vs_top_hitters` already needs 253s on STAGING. Prod is a SMALLER compute tier with a MORE throttled
disk (expect ~8-10 min for that one dimension), and prod's `exec_sql` has ALREADY been observed timing out on lighter
queries. Through the gateway this dimension would fail on prod **100% of the time**, and the script HALTS on failure,
so it would also block the 8 dimensions that come after it. `--direct` is NOT a staging workaround — it is the
REQUIRED path on prod.

## NEW FLAGS ADDED TO `aggregate_pitch_log_dimensions.ts` (2026-08-30)
- **`--direct`** — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling) instead of
  `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs which path is used.
- **`--only=<keys>`** — mirrors `--skip=`; runs ONLY the named dimension(s). Makes step 4 targetable, so a single
  failed dimension can be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- (existing) **`--skip=<keys>`** — skip named dimensions.

## ⚠ THE TRAP THIS CREATED — A STALE DIMENSION THAT LOOKS POPULATED
When `vs_top_hitters` failed, `pitch_log_pitcher_totals` still SHOWED **5,349 rows** for that `dimension_key` — rows
left over from a PRE-v2 run, computed from OLD labels and OLD Stuff+ scores. **A row-count check would have passed.**
→ After ANY reclassification, verify a dimension by FRESHNESS (did this run write it?), never by row count.
→ Related: the script **exits 0 even when a dimension FAILED** — validate by CONTENT (grep the log for `FAILED` and
for the per-dimension `ok`), never by exit code. A run was wrongly marked COMPLETE this way on 2026-08-29.
