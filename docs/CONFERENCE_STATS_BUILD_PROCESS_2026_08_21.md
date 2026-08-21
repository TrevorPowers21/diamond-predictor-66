# CONFERENCE STATS BUILD PROCESS — full map + edge-fn spec (2026-08-21)

The `"Conference Stats"` table (one row per **conference_id × season**) FEEDS the transfer projections (env+, Stuff+, HTP, park levers) + team_season_stats conf context. It is currently filled by **~6 disconnected producers** (2 automatic cascade steps, 2 manual TS scripts, 1 manual/commented SQL, 1 DEAD Savant UI button). **No single process fills it, and several populated columns have NO committed producer** → they came from hand-run SQL and **will NOT reproduce on prod** unless codified. This doc maps every column and specifies the ONE automatic edge-fn step (Track B).

## ⚠️ PROD-PUSH RISK — columns populated by uncommitted hand-run SQL
These are populated on staging (feed transfers) but **nothing in the repo writes them** → must be codified before the prod push or they'll be empty on prod:
- **`WRC_plus`** — only writer is the **commented-out** `scripts/sql/conf_stats_unified_assembly.sql:28` (`(0.011+0.691·OBP+0.235·SLG)/0.3782·100`).
- **`hitter_talent_plus` (HTP)** — NO committed producer; live-computed in 4 display sites; DB values from a hand-run SQL. Formula `OPR + 1.25·(Stuff+−100) + 0.75·(100−wRC+)`. Currently keys off `Overall_Power_Rating` (the populated col), NOT the empty `offensive_power_rating`.
- **`run_env_factor` (conf park)** — NO writer at all (read-only in repo). Planned: conf-avg of member teams' `rg_factor` from `"Park Factors"`, 3-yr rolling, normalized 100. Genuinely unbuilt.
- **Raw rates** (AVG/OBP/…/ERA/FIP) — 3 competing writers, the canonical (pitch-log Bucket-A assembly) has its `UPDATE` **commented out**.
- **`offensive_power_rating` (OPR)** — 0/30, only writer (`conferenceScoutingAverages`) has a DEAD caller.

## Per-column producer map
| Column(s) | Producer (file:line) | Source | Automatic? |
|---|---|---|---|
| Raw rates AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9 | `scripts/sql/conf_stats_unified_assembly.sql` (canonical, **UPDATE commented out :24-30**) · `src/lib/importConferenceStats.ts:130` (CSV) · `populate-conference-stats-env-plus.ts:305` (JUCO) | `pitch_log` **is_conference_game=true** (intra-conf) → rates; ERA via DRS earned; cFIP 3.157 | canonical=manual; CSV=on-upload |
| Hitter env+ ba/obp/iso/slg_plus | **`computeConferenceEnvRates`** `importConferenceStats.ts:165` = `(rate/ncaa)*100` | ConfStats rates ÷ `ncaa_averages` | **AUTO** (cascade `import-csvs/runner.ts:630`) — needs rates + ncaa first |
| Pitcher env+ era…hr9_plus | **`compute_conf_pitcher_env_plus.ts`** (2026-08-21) ratio scale | ConfStats rates ÷ ncaa means (+WHIP live) | manual (`--apply`); cols via mig `20260821000000` |
| Stuff_plus | `conferenceStuffPlus.ts:42` V1 (AUTO cascade) / `conferenceStuffPlusV2.ts:224` V2 (canonical, manual) | Master.stuff_plus × pitch counts; **full season** | V1 auto, V2 manual — retire V1 |
| Overall_Power_Rating | `populate-conference-stats-env-plus.ts:122` Phase 1b | PA-weighted Hitter Master `overall_power_rating` via Teams Table.conference_id | manual |
| **offensive_power_rating (OPR)** | `conferenceScoutingAverages.ts:344,474` = `0.15·ba+ +0.4·obp+ +0.45·iso+` | scouting sub-metrics → ba/obp/iso PR | **DEAD (0/30)** — caller is dead Savant button |
| WRC_plus | `conf_stats_unified_assembly.sql:28` (**commented**) | C1 OBP/SLG | manual/none |
| **hitter_talent_plus (HTP)** | **none committed** (live in 4 display sites; hand-run SQL) | OPR + Stuff+ + wRC+ | **none** |
| run_env_factor (park) | **none** (read-only) | conf-avg team `rg_factor` (Park Factors) | **none** |
| ba/obp/iso_power_rating | `conferenceScoutingAverages.ts` (dead) + JUCO | scouting scores `(raw/50)*100` | dead/manual |

## Order / dependency chain
Automatic cascade (`import-csvs/runner.ts`, on CSV upload): addPlayers → refreshPaIp → **computeAndStoreNcaaAverages** → computeScores → createPredictions → **Stuff_plus (V1)** → **hitter env+ (`computeConferenceEnvRates`)** → bulkRecalc.
Everything else out-of-band manual: raw-rate assembly SQL, Overall_PR, pitcher env+, JUCO rows, WRC_plus, HTP, run_env_factor.

**Scope rule (locked):** raw rate stats = **intra-conference games only** (`is_conference_game=true`); Stuff+/OPR/HTP/park = **full season, conf-vs-conf** (small-sample). [[project_conference_stats_scope_rule]]

## THE UNIFIED EDGE-FN CONF-STATS-DERIVE STEP (Track B) — per conference_id × season, IN ORDER
1. **Raw rates** from `pitch_log` `is_conference_game=true` (fold in Bucket-A `_conf_agg` SQL). Store AVG/OBP/ISO/SLG/ERA/FIP/WHIP/K9/BB9/HR9.
2. **Stuff_plus** (V2 pitch-log, full season) + **Overall_Power_Rating** + **ba/obp/iso_power_rating** + **offensive_power_rating (OPR)** — fold the dead `conferenceScoutingAverages` logic in so OPR actually populates.
3. **Hitter env+** (`computeConferenceEnvRates`) + **pitcher env+** (`compute_conf_pitcher_env_plus` ratio) vs fresh `ncaa_averages`.
4. **WRC_plus** (C1) + **run_env_factor** (conf-avg team `rg_factor`, add column first).
5. **hitter_talent_plus (HTP) LAST** (needs OPR + Stuff+ + park): the canonical stored HTP (see below). NO live compute — every reader reads this stored column.
6. JUCO district rows in same pass. Key on **conference_id + season**. Retire V1 Stuff+, manual `populate-conference-stats-env-plus.ts`, commented assembly SQL.

## CANONICAL HTP (2026-08-21 decision) — store, don't compute live
`HTP = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env_factor)` where **OPR = `offensive_power_rating`** (`0.15·ba+ + 0.4·obp+ + 0.45·iso+`, to be stored) and the **park swap** replaces the old `(100 − wRC+)` term with `(100 − run_env_factor)` (strips run-environment inflation from hitter talent — the Ivy double-count fix, modeled+validated 08-13). Stored in `hitter_talent_plus`; read by transfer precompute + edge fn + display (no live compute).

## GAPS TO CODIFY (before prod push)
1. OPR producer (0/30) → commit + run.
2. HTP producer (no committed writer) → commit the canonical-HTP compute.
3. WRC_plus → commit (uncomment/port the assembly SQL).
4. run_env_factor → BUILD (conf-avg rg_factor).
5. Raw-rate producer → un-comment/commit the pitch-log assembly (single source; retire CSV/UI writers).
6. Reconcile duplicate env+ + V1/V2 Stuff+ + conference-abbreviation-vs-conference_id keying.
