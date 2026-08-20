# AGENT LEARNINGS — WAR Recalibration Audit + Plan (2026-08-20)

Companion to `docs/AUDIT_war_recalibration_state.md` (findings) and `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` (the 13-step plan + DB ledger + execution order). This file = the non-obvious learnings so the next session doesn't re-derive them.

## Verified clean (don't re-audit)
- **WAR formulas** (wRC+ C1, oWAR, pRV+/D1-FIP, pWAR) exact + consistent across `src/`, edge fns, SQL; composite `total=o+d+bsr` reproduces on staging to full precision; **269/269 tests pass**.
- **Power-rating canonical** (`powerRatings.ts`) matches the 2026-08-11 refits; stored `*_pr_plus` reproduce from stored scores (Δ<0.01).
- **team_season_stats** 308 teams, WAR rollups = Σ Masters **exactly (0.0000)**; records game_string-keyed (Georgia 53-14 / 23-7 SEC); pitcher_full_name corruption fixed (1 name/pitcher_id).
- **Migrations safe** — NO migration drops any irreplaceable table. `team_war_snapshots` DROP was only stale *doc language*.

## The real problems (all in the runbook as steps)
1. **`whip_pr_sd` 24.59→37.13** and **`obp_std_pr` 28.89→32.41** stale after composite refits. Confirmed on latest ratings (whip IP≥40, obp PA≥60). obp is returner+transfer (it's `StdDevOBPPowerRating`).
2. **Conference env+ inconsistency:** only the *player power ratings* got the /50×100 rebuild. The *conference env+* transfer lever still scales **pitchers z×20** while **hitters use the `(conf/ncaa)×100` ratio**. Missed step → put pitchers on the ratio.
3. **Broken recompute path:** commit `54cdb10` deleted `fetchAllPredictionsForReturnerMode` but it's still called in `bulkRecalculatePredictionsLocal` → ReferenceError. `vite build` hides it (esbuild transpile-only); `tsc` catches TS2304.
4. **NaN fallback** `pitcherProjection.ts:301-339` reads `eq.p_*` composite weights the code never defines → NaN (shadowed by stored values). Remove it.

## Edge-fn / model_config learnings (the biggest ones)
- **`recalculate-prediction` edge fn is the returner recompute target**, but its returner-hitter math is a **multiplicative model that ignores the power rating for OBP** (`usePR=false`). Trevor's intended model is the **SD-blend**: `ScaledOBP = NCAAAvgOBP + ((OBPPR+ − NCAAAvgPR)/StdDevOBPPR)×StdDevNCAAOBP` → blend → `×(1+ClassAdj+DevAgg·0.06)`. **Must be rewritten to use the power rating.**
- **The returner equation IS fully stored** in `model_config` as `r_*` keys under `model_type='admin_ui'` (std_pr, class bases, damp tiers, ncaa avgs, wRC weights). Trevor was right; store-everything is largely done.
- **The edge fn's model_config read is TRIPLE-BROKEN:** filters `model_type='returner'` (0 rows → all are `admin_ui`), checks **bare** key names (not `r_`-prefixed), and never reads `*_std_pr`. So it runs 100% on hardcoded Deno defaults. **Deno edge fns can't import `src/` → model_config IS their source of truth → everything must read it (rewire required).**
- **Recompute is fragmented:** returner hitters = `recalculate-prediction` edge fn; returner pitchers = `precompute-returner-pitchers.ts` script; transfer per-team = `process-precompute-jobs` edge fn — three separate Deno/TS math copies. Goal (logged): **consolidate into ONE edge fn.**
- **Edge-fn pitcher IP drift:** edge uses flat coarse-role IP (no `ip` input); canonical uses last-year-IP → depth role → projected IP (toggle-reactive). Fix in edge fn.

## Store-everything directive (Trevor 2026-08-20) — two modes
- **`src/` TS code:** code is source of truth; `model_config` + admin page hold a **read-only mirror** (matching values) for lookup/consistency.
- **Deno edge fns:** model_config is the **actual source** (they can't import code) → they MUST read it correctly.

## Flag resolutions (locked)
- `ncaa_averages` `pitcher_exit_velo`/`ev90`/`in_zone_pct` = the **hitter averages 1-for-1** (same batted-ball population), stored both sides.
- Conference-level `iso/obp_power_rating` (prod-only) are **live-read** by ConferenceStatsPage/Savant — **reconcile display, don't drop**. Per-player ba/obp/iso_power_rating (Masters) are used in projections + stay.
- `vaa` / `classification_version` — **known limitation, deferred** (upload miss).

## Run discipline
- **Run RETURNERS now** (post-fix, via edge fn). **Do NOT run TRANSFER** until its SD + weighted-impact (env+ ratio conversion + weights) is finished + verified.
- **JUCO entirely out of scope** — separate audit/session. Keep all this D1.

---

## PITCH-LOG-PRIMARY PIPELINE — Step 1 built (2026-08-20)

**Decision (Trevor):** upload pitch log → derive ALL metrics → write into BOTH `Hitter Master` + `Pitching Master`. TruMedia Master stays source of truth but **sporadic** (fill/override). Collapses today's two parallel sources (Masters=TruMedia drive projections; `pitch_log_*_totals` drive the Savant display, reconciled by `audit_pitch_log_vs_master.ts`) into one.

**Current state confirmed:** `ingest_pitch_log.ts` → `pitch_log` → SQL rollups → `pitch_log_hitter_totals`/`pitch_log_pitcher_totals`. `computeAndStoreScores` reads/writes `Hitter Master` (TruMedia-fed). No marry-into-Master function existed → that's what we built.

**Built:** `scripts/derive_masters_from_pitchlog.ts` (reuses `src/savant/lib/pitchLogRates.ts` `deriveHitterRates`/`derivePitcherRates`). D1 only. DRY-RUN verified, **NOT applied**. Fill/override: pitch-log primary; null/untracked or thin (`--min-pa 25`/`--min-bf 20`) → keep Master value (Master fills). Creates new rows for pitch-log-only players (needed for 2027).

**Hitter derive verified** (reproduces Master): AVG/SLG/ISO ~exact; OBP within ~0.01 (lib uses total `sac` for SF by documented v1 convention). Units: Master pct cols are 0-100 → ×100 the 0-1 lib rates; AVG/OBP/SLG/ISO stay rates; EV in mph.

**PITCHER IP via per-PA out-attribution (the hard part, SOLVED + validated):**
- Team method `Σ(max(outs)+1)/3` breaks at pitcher grain (relievers share a half-inning). Correct: outs on a PA = `next PA start-outs − this PA start-outs`; last PA = `max(outs)+1 − start`; credited to that PA's pitcher. Sums to the team total exactly.
- **Validated vs Master (n=2835, IP≥20): IP corr 0.9995 (avg −0.70 IP), K9 0.9971, BB9 0.9982, WHIP 0.9959.** The −0.70 = innings not reaching 3 outs in the log (end-of-game); Master fills it sporadically.
- Migration: `ALTER pitch_log_pitcher_totals ADD COLUMN ip numeric` + populate via the CTE (applied to staging 2026-08-20 by Trevor). Full SQL in `docs/PROD_PUSH_RUNBOOK_war_recalibration.md`.
- Rates from `ip` + existing counts (`total_k/total_bb/total_hbp/hits_*_allowed`): `K9=total_k·9/ip, BB9, HR9, WHIP=(Σhits+total_bb)/ip`.

**⭐ FIP — descriptive ≠ projection (Trevor's key distinction, caught by verifying):**
- `Pitching Master.FIP` = **descriptive/last-season classic FIP** = `(13·HR + 3·(BB+HBP) − 2·K)/IP + 3.157` (D1 cFIP). **Verified matches Master to ~0.01** (DeRossi 6.33/6.33 exact).
- `computeProjFip` (`pitcherQuality.ts`) = the **PROJECTION** D1-FIP regression index → feeds `pRV+`/`pWAR`. A DIFFERENT column/purpose. The subagent wrongly used it for the descriptive Master FIP → fixed to classic. **Never conflate descriptive last-season FIP with projection FIP.**

**Left to TruMedia Master (never derived):** `ERA` (earned-run attribution noisy), `IP, G, GS, Role`.

**Schema:** added UNIQUE `(source_player_id, Season)` on both Masters (was missing; needed for upsert). SQL in runbook.

**Change counts (dry-run, 2026):** 4,374 hitters / 4,772 pitchers would update.

**NEXT in the pipeline walkthrough:** `ncaa_averages` refresh (from new Masters) → `compute_scores` (Master → `*_score`/`*_power_rating`) → `create_predictions` → recompute. Conference-to-conference rollups (env+/Stuff+/HTP) feed the TRANSFER levers (deferred with transfer).
