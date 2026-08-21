# CONFERENCE STATS BUILD PROCESS — full map + edge-fn spec (2026-08-21)

The `"Conference Stats"` table (one row per **conference_id × season**) FEEDS the transfer projections (env+, Stuff+, HTP, park levers) + team_season_stats conf context. It is currently filled by **~6 disconnected producers** (2 automatic cascade steps, 2 manual TS scripts, 1 manual/commented SQL, 1 DEAD Savant UI button). **No single process fills it, and several populated columns have NO committed producer** → they came from hand-run SQL and **will NOT reproduce on prod** unless codified. This doc maps every column and specifies the ONE automatic edge-fn step (Track B).

## ⚠️ PROD-PUSH RISK — columns populated by uncommitted hand-run SQL
These were populated on staging (feed transfers) but at audit time **nothing in the repo wrote them** → had to be codified before the prod push or they'd be empty on prod. **Status column shows resolution (2026-08-21).**
- **`WRC_plus`** — writer was the **commented-out** `conf_stats_unified_assembly.sql:28` (`(0.011+0.691·OBP+0.235·SLG)/0.3782·100`). ✅ CODIFIED → `scripts/sql/conf_stats_bucketA_assembly.sql` (a960334).
- **`hitter_talent_plus` (HTP)** — was live-computed in 4 display sites; DB values from hand-run SQL. ✅ CODIFIED → `scripts/derive_conf_opr_htp.ts` (04f6d52). Canonical formula `Overall_Power_Rating + 1.25·(Stuff+−100) + 0.75·(100 − run_env_factor)` (park swap). OPR term = `Overall_Power_Rating` (see OPR note below).
- **`run_env_factor` (conf park)** — was read-only/no writer. ✅ VERIFIED (= simple avg of member `rg_factor`) + CODIFIED → `derive_conf_opr_htp.ts`.
- **Raw rates** (AVG/OBP/…/ERA/FIP) — canonical pitch-log Bucket-A assembly had its `UPDATE` commented out. ✅ CODIFIED → `conf_stats_bucketA_assembly.sql`. (CSV/UI writers still exist — retire in edge-fn fold.)
- **`offensive_power_rating` (OPR)** — was 0/30 (only writer had a DEAD caller). ✅ RECONCILED → `offensive_power_rating = Overall_Power_Rating` in `derive_conf_opr_htp.ts` (one OPR number everywhere).

## Per-column producer map
| Column(s) | Producer (file:line) | Source | Automatic? |
|---|---|---|---|
| Raw rates AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9 | `scripts/sql/conf_stats_unified_assembly.sql` (canonical, **UPDATE commented out :24-30**) · `src/lib/importConferenceStats.ts:130` (CSV) · `populate-conference-stats-env-plus.ts:305` (JUCO) | `pitch_log` **is_conference_game=true** (intra-conf) → rates; ERA via DRS earned; cFIP 3.157 | canonical=manual; CSV=on-upload |
| Hitter env+ ba/obp/iso/slg_plus | **`computeConferenceEnvRates`** `importConferenceStats.ts:165` = `(rate/ncaa)*100` | ConfStats rates ÷ `ncaa_averages` | **AUTO** (cascade `import-csvs/runner.ts:630`) — needs rates + ncaa first |
| Pitcher env+ era…hr9_plus | **`compute_conf_pitcher_env_plus.ts`** (2026-08-21) ratio scale | ConfStats rates ÷ ncaa means (+WHIP live) | manual (`--apply`); cols via mig `20260821000000` |
| Stuff_plus | `conferenceStuffPlus.ts:42` V1 (AUTO cascade) / `conferenceStuffPlusV2.ts:224` V2 (canonical, manual) | Master.stuff_plus × pitch counts; **full season** | V1 auto, V2 manual — retire V1 |
| Overall_Power_Rating (**= the OPR used by HTP**) | `populate-conference-stats-env-plus.ts:122` Phase 1b | **PA-weighted average of hitters' `overall_power_rating`** (Hitter Master) via Teams Table.conference_id. NB: each hitter's `overall_power_rating` is created by the per-PLAYER composite `0.15·ba+ +0.4·obp+ +0.45·iso+`; the CONFERENCE number is just the PA-avg of those — the composite is the player-PR equation, NOT a per-conference calc. | manual → ✅ folds into `derive_conf_opr_htp.ts` |
| **offensive_power_rating (OPR display col)** | was `conferenceScoutingAverages.ts:344,474` (dead, 0/30) → ✅ **reconciled = `Overall_Power_Rating`** (`derive_conf_opr_htp.ts`) | = Overall_Power_Rating (one OPR everywhere) | ✅ codified |
| WRC_plus | ✅ `conf_stats_bucketA_assembly.sql` (was commented) | C1 OBP/SLG intra-conf | codified |
| **hitter_talent_plus (HTP)** | ✅ `derive_conf_opr_htp.ts` (was live in 4 sites) | Overall_PR + 1.25(Stuff+−100) + 0.75(100−run_env_factor) | codified, stored, read-only |
| run_env_factor (park) | ✅ `derive_conf_opr_htp.ts` (was no writer) | simple avg of member team `rg_factor` (Park Factors, by conference_id) | codified |
| ba/obp/iso_power_rating | `conferenceScoutingAverages.ts` (dead) + JUCO | scouting scores `(raw/50)*100` | dead/manual (display-only; not used by HTP) |

## Order / dependency chain
**TRUE ORDER (log the exact truth — Trevor):** counting stats come FIRST. The intra-conf assembly aggregates terminal-PA COUNTS per conference (H, AB, BB, HBP, SF, K, IP, HR, 2B, 3B, runs) → **derives rates** (AVG=H/AB, OBP, ISO, SLG, ERA/FIP/WHIP/K9/BB9/HR9) → **THEN env+** (`ba_plus`… = rate ÷ ncaa_average × 100) which REQUIRES the rates already present → **THEN WRC_plus** (C1 on OBP/SLG). So `populate-conference-stats-env-plus.ts` (env+) is DOWNSTREAM of the raw-rate assembly — the PA/AB/rate fields must exist before it runs. In parallel (full-season, not intra-conf): OPR (=PA-avg Overall_PR), Stuff+, run_env_factor (park) → **HTP LAST** (needs OPR + Stuff+ + park).
Automatic cascade today (`import-csvs/runner.ts`, on CSV upload): addPlayers → refreshPaIp → **computeAndStoreNcaaAverages** → computeScores → createPredictions → **Stuff_plus (V1)** → **hitter env+ (`computeConferenceEnvRates`)** → bulkRecalc.
Everything else was out-of-band manual (now codified): raw-rate assembly SQL, Overall_PR, pitcher env+, JUCO rows, WRC_plus, HTP, run_env_factor.

**Scope rule (locked):** raw rate stats = **intra-conference games only** (`is_conference_game=true`); Stuff+/OPR/HTP/park = **full season, conf-vs-conf** (small-sample). [[project_conference_stats_scope_rule]]

## THE UNIFIED EDGE-FN CONF-STATS-DERIVE STEP (Track B) — per conference_id × season, IN ORDER
1. **Counting stats → raw rates** from `pitch_log` `is_conference_game=true` (fold in Bucket-A `_conf_agg` SQL): aggregate H/AB/BB/HBP/SF/K/IP/HR counts FIRST, then derive AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9. Store all.
2. **Stuff_plus** (V2 pitch-log, full season) + **Overall_Power_Rating** (PA-avg of hitters' `overall_power_rating`) + **offensive_power_rating (OPR) = Overall_Power_Rating** (reconcile to one number). (Legacy `ba/obp/iso_power_rating` scouting composite = display-only; not on the HTP path.)
3. **Hitter env+** (`computeConferenceEnvRates`) + **pitcher env+** (`compute_conf_pitcher_env_plus` ratio) vs fresh `ncaa_averages` — REQUIRES step-1 rates present.
4. **WRC_plus** (C1 on step-1 OBP/SLG) + **run_env_factor** (simple avg of member team `rg_factor`).
5. **hitter_talent_plus (HTP) LAST** (needs OPR + Stuff+ + park): the canonical stored HTP (see below). NO live compute — every reader reads this stored column.
6. **team_season_stats refresh** in the same pass (`refresh_team_season_stats`) — pulls conf_stuff_plus/conf_htp/conf_opr from the fresh Conference Stats + faced-competition + park.
7. JUCO district rows in same pass. Key on **conference_id + season**. Retire V1 Stuff+, manual `populate-conference-stats-env-plus.ts`, commented assembly SQL.

## CANONICAL HTP (2026-08-21 decision) — store, don't compute live
`HTP = Overall_Power_Rating + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env_factor)` where **OPR = `Overall_Power_Rating`** (the PA-weighted average of hitters' `overall_power_rating` — NOT the `0.15·ba+/0.4·obp+/0.45·iso+` composite, which is the per-PLAYER PR equation, not a per-conference calc; `offensive_power_rating` is reconciled to equal it). The **park swap** replaces the old `(100 − wRC+)` term with `(100 − run_env_factor)` (strips run-environment inflation from hitter talent — the Ivy double-count fix, modeled+validated 08-13). Stored in `hitter_talent_plus`; read by transfer precompute + edge fn + display (no live compute). Producer: `scripts/derive_conf_opr_htp.ts`.

## GAPS TO CODIFY (before prod push) — ALL ✅ DONE 2026-08-21
1. ✅ OPR (0/30) → reconciled = Overall_Power_Rating (`derive_conf_opr_htp.ts`).
2. ✅ HTP → canonical park-swap producer (`derive_conf_opr_htp.ts`), stored + read-only.
3. ✅ WRC_plus → `conf_stats_bucketA_assembly.sql` (a960334).
4. ✅ run_env_factor → conf-avg `rg_factor`, verified + committed (`derive_conf_opr_htp.ts`).
5. ✅ Raw-rate producer → `conf_stats_bucketA_assembly.sql` (single source; CSV/UI writers to retire in edge-fn fold).
6. ⏳ REMAINING: reconcile duplicate env+ (cascade vs `populate-conference-stats-env-plus`) + V1/V2 Stuff+ + conference-abbreviation-vs-conference_id keying — do in the Track-B edge-fn fold. Plus the staging idempotent re-verify of `conf_stats_bucketA_assembly.sql` vs `_confstats_backup_preassembly`.

---
## RESOLVED (2026-08-21) — OPR/park/HTP defined + committed producer `scripts/derive_conf_opr_htp.ts`
- **OPR clarified (Trevor):** the OPR for HTP is the **PA-weighted average of hitters' `overall_power_rating`** = `Overall_Power_Rating` (populated 30/30) — NOT the `0.15·ba+/0.4·obp+/0.45·iso+` composite. That composite (`offensive_power_rating`) is a redundant/display metric; **reconciled by setting `offensive_power_rating = Overall_Power_Rating`** so one OPR shows everywhere.
- **`run_env_factor` VERIFIED = simple avg of member teams' `rg_factor`** (Park Factors, by conference_id): SEC 94.20, Ivy 98.92, NEC 112.35 — exact match to stored. Committed producer added (was previously unbuilt/no-writer).
- **Canonical HTP = `Overall_Power_Rating + 1.25·(Stuff+−100) + 0.75·(100 − run_env_factor)`** (park swap). **The stored `hitter_talent_plus` ALREADY matched this 30/30** (0/30 matched pre-swap `100−wRC+`) — Trevor hand-stored the park-swap version. The BUG was the readers COMPUTED HTP live (pre-swap): `precompute-pitchers`, edge fn (which even used `Overall_Power_Rating` alone!), TeamBuilder, TransferPortal, ConferenceStatsPage. **All now READ stored `hitter_talent_plus`; live compute removed.** Pitcher transfers re-run on stored HTP.
- **Order correction (log the truth):** raw counting stats (PA/AB) + rates (AVG/OBP/…) are produced FIRST (pitch-log intra-conf assembly), THEN env+ (which divides rates by ncaa), THEN OPR/Stuff+/park, THEN HTP LAST (needs OPR+Stuff++park).
- **team_season_stats is part of this feature-branch build too** — `refresh_team_season_stats(season)` (mig 20260819010000) rolls up Σ Masters desc WAR + conf context (conf_stuff_plus/conf_htp/conf_opr from Conference Stats) + faced-competition + park + records; 308 D1 rows populated; descriptive (2026 actual), separate from projections. Verify/refresh it in the same pass.
- **Producer:** `scripts/derive_conf_opr_htp.ts --apply` (idempotent) — the committed, reproducible version of run_env_factor + OPR + canonical HTP. Folds into the edge-fn conf-stats-derive step (after Stuff+ + park, computes HTP last).
