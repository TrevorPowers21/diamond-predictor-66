# HANDOFF — `team_season_stats` (the canonical per-team-per-season table)

**Created 2026-08-19 · branch `feature/war-recalibration` · staging-first**
Companion to `docs/HANDOFF_STUFF_PLUS_2026_08_16.md` (§team_season_stats) + `docs/AGENT_LEARNINGS_stuff_plus_2026_08_16.md`.
Every schema/SQL change here is logged in `PROD_MIGRATIONS_TODO.md` (§team_season_stats) — that file is the authoritative prod runbook.

---

## 1. Why this exists
The system has **no team-stats layer**. Team WAR lives in `team_war_snapshots`; park in `"Park Factors"`; conference metrics in
`"Conference Stats"` — scattered, and nothing holds a team's full-season line, records, faced-competition, or a bsrWAR/dWAR team
rollup. Oregon State transfers (Independents) forced the issue: to evaluate their competition we need **faced Stuff+/HTP per team**,
which has nowhere to live. `team_season_stats` becomes that canonical home — and the Masters philosophy applied to teams: **ONE table,
one row per team per season, holding everything, written automatically by the ONE edge function** (the North Star: no manual runs).

## 2. Keys (investigated + confirmed)
- `source_id` = **STABLE program id** (repeats every season — OSU 3111, UGA 226 both 2025 & 2026). **Natural key = `(source_id, season)`.**
- `team_season_id` = the **per-season `"Teams Table".id`** (uuid, unique per team-season) — stored for joins/consistency (like `team_builds`).
- `conference_id` (stable per team unless realignment) + `team_name`/`abbreviation`.
- 774 team-seasons / 466 programs across 2 seasons.

## 3. Build rule (Trevor)
**team = Σ player values.** Sum every counting stat (per window) → **DERIVE weighted rates from the sums** (the PA/IP weight falls out;
never average player rates). **team WAR = Σ player WAR** (per window). Records/park/conf/faced come from their own sources. Stored, not live.

## 4. Windows
Every **WAR** column is stored twice: `_reg` (regular season) + `_total` (incl. postseason), split on the **season boundary
(reg ends 2026-05-18** — `season_config`, same boundary desc WAR needs). Counting stats stored both windows too (cheap → rates
derivable either way). Rates are **derived**, not window-mandated (AVG "is what it is" — total is fine; reg optional).

## 5. Column groups + EXACT source (grounded in DB probe 2026-08-19)

| Group | Columns | Source | Notes |
|---|---|---|---|
| **Keys** | source_id, team_season_id, season, conference_id, team_name, abbreviation | `"Teams Table"` | source_id stable, id per-season |
| **Records** ⭐NEW run | w/l overall, w/l conference (+ total incl post) | `pitch_log` game outcomes (runs/game → W/L; `is_conference_game` → conf record) | NOT a player rollup. Enables **wins-over-projection** (future: actual vs projected-from-team-WAR) |
| **Hitting counting** | pa, ab, h, 2b, 3b, hr, bb, hbp, k, sb, cs, sf… | `pitch_log` agg (conf-stats machinery) | Σ; both windows |
| **Hitting rates** (derived) | avg, obp, slg, iso, ops, wrc+ | from the summed counts | proper denominator = sum-then-divide |
| **Pitching counting** | ip(=outs/3), k, bb, hbp, hr, h, er… | `pitch_log` agg | Σ; both windows |
| **Pitching rates** (derived) | era, fip, whip, k9, bb9, hr9 | from summed counts | er via DRS earned-run tagging |
| **WAR matrix** ⭐ | owar, dwar, bsrwar, pwar, total_war — each `_reg` + `_total` | **Σ Hitter Master + Σ Pitching Master** (see §6) | pure aggregation — split already at player level |
| **Snapshot carry** | proration_factor, games_played_est, n_hitters, n_pitchers, team_drs, is_national_champ, is_conference_champ, national_seed_rank | migrate from `team_war_snapshots` | preserves 2025 champions |
| **Conference-scoped** | conf rate line + conf_stuff_plus, conf_htp, run_env_factor | migrate from `"Conference Stats"` | intra-conf scope rule |
| **Competition (faced)** | faced_stuff_plus, faced_htp | `pitch_log` opponent schedule × per-conf metric | proven (OSU faced Stuff+ 100.3 / HTP 104.6) |
| **Park (federated snapshot)** | park_single_season + park_rolling_3yr (per component) | snapshot from `"Park Factors"` | `"Park Factors"` STAYS as historical source |
| **Future** | home/road splits, per-player faced | — | later |

## 6. ★ KEY FINDING — the WAR reg/total split ALREADY exists per player (DB probe 2026-08-19)
The WAR rollup is a **pure `SUM ... GROUP BY (TeamID, Season)`** — no player-level boundary work needed:
- **Hitter Master** carries: `desc_owar, d_war, bsr_war, total_desc_war` (total) **and** `desc_owar_reg, d_war_reg, bsr_war_reg,
  total_desc_war_reg` + `regular_season_pa, pa, ab` (+ woba/wraa & _reg).
- **Pitching Master** carries: `desc_pwar, total_desc_war, desc_ra9, desc_fip_ra9, drs_behind` (total) **and** `desc_pwar_reg,
  total_desc_war_reg, …_reg` + `regular_season_ip, IP`.
- team oWAR = Σ Hitter Master.desc_owar; team dWAR = Σ d_war; team bsrWAR = Σ bsr_war; team pWAR = Σ Pitching Master.desc_pwar;
  team total_war = Σ (hitter total_desc_war) + Σ (pitcher total_desc_war). Same for every `_reg`.
- ⚠ Join key: Masters `TeamID` + `Season` → `"Teams Table"` (id per-season) → source_id + conference_id. **Confirm TeamID = Teams
  Table.id vs source_id during build** (first DDL/rollup step).

## 7. team_war_snapshots — MIGRATE, don't scrub (prod check 2026-08-19)
- **Staging:** 2026 only, 308 rows.
- **Prod:** **2025 = 309 rows (incl. Louisiana State national champ + 39 conference champs) + 2026 = 466 rows.** The 2025
  championship history lives ONLY on prod.
- Subsume = **migrate every existing row first** (season is a key → each becomes a team_season_stats row; champion flags/seed/
  proration carried), A/B-verify WAR cols, THEN `DROP TABLE team_war_snapshots`. **Prod migration must read prod's own table** (it has 2025).

## 8. Park + team_war_snapshots fates (recap)
- `team_war_snapshots` = SAME grain → **SUBSUME** (migrate history in, retire after verify).
- `"Park Factors"` = DIFFERENT grain (park-data input store, all history) → **FEDERATE** (keep as source; snapshot used values in).

## 9. Execution order (build-check-then-clear; all folds into the ONE edge fn)
0. **Confirm Masters `TeamID` join key** → `"Teams Table"` (id vs source_id) + that source_id/conference_id resolve.
1. **`CREATE TABLE team_season_stats`** on staging — full column set (§5) + RLS ENABLE (service-role pipeline table). Log DDL to prod runbook.
2. **WAR rollup** — `SUM ... GROUP BY (source_id, season)` from Hitter Master + Pitching Master (both windows). A/B team totals vs
   `team_war_snapshots` (prorated/raw as applicable). Pure aggregation (§6).
3. **Counting + rates** — pitch_log agg (reuse conf-stats machinery) → team counting stats → derive rates. A/B vs known team lines.
4. **Records run** (NEW) — pitch_log game outcomes → overall + conference W-L.
5. **Migrate** team_war_snapshots rows (champion flags/seed/proration) + **migrate** Conference Stats conf-scoped fields.
6. **Faced** (faced_stuff_plus/htp) + **Park snapshot** (single-season + rolling from "Park Factors").
7. **Fold the whole build into the edge-fn stage** (alongside conf-stats) so it runs automatically on ingest. THEN repoint readers +
   retire team_war_snapshots (build-check-then-clear). Every DDL/DROP/repoint logged in the prod runbook as applied.

## 10. Verify plan
- WAR: team_season_stats `_total` owar/pwar A/B vs `team_war_snapshots` raw_total_owar/pwar (corr → exact within rounding).
- Rates: spot-check 3-5 teams' AVG/ERA vs a known source.
- Records: spot-check W-L vs published records for a couple teams.
- Faced: OSU faced Stuff+ ≈ 100.3 / HTP ≈ 104.6 (already proven).
- Conf-scoped: matches migrated Conference Stats values.

## 11. Open decisions
- (settled) Records IN for v1 (wins-over-projection payoff). Park = both single-season + rolling. team_war_snapshots migrate not scrub.
- (to confirm at build) Masters `TeamID` semantics (per-season id vs source_id) for the join.

## ★ team_season_stats — BUILD PROGRESS + DECISIONS (2026-08-19, staging)
STEP 1 DONE: CREATE TABLE team_season_stats (117 cols) + RLS, staging. Migration supabase/migrations/20260819000000_team_season_stats.sql.
STEP 2 DONE: WAR rollup (Σ Masters, reg+total), D1 ONLY. 308 rows. VERIFIED: pWAR corr 1.0000 / max diff 0.005 vs
team_war_snapshots.raw_total_pwar (exact); oWAR = Σ desc_owar correct by construction (Arkansas 16 hitters, 0 null, Σ=8.86).
SQL: scripts/sql/team_season_stats_war_rollup.sql.

DECISIONS (Trevor 2026-08-19):
- **D1 ONLY** — JUCO (NJCAA_D1, 158 teams) EXCLUDED. Descriptive WAR is D1 (all 5343 D1 hitters have desc_owar; all 2903 JUCO NULL).
  JUCO runs on the projection overlay elsewhere. (Aligns with the Division Table Separation direction.)
- **DESCRIPTIVE ONLY — no projection WAR block.** Projection is a TEAM BUILDER function living in a DIFFERENT area; we have NO
  historical projections. 2027 is the FIRST time we store preseason projections + a LIVE desc WAR accumulating through the season
  (+ per-play). team_season_stats holds 2026 descriptive now; 2027 desc WAR folds in from the pitch log (not projection) as the season builds.
- **ONE future column added:** preseason_proj_total_war (nullable, per program) — for tracking players/programs vs preseason
  expectation; populated starting 2027 preseason. Per-PLAYER preseason projection lives elsewhere/future. NOT a blocker to this build.
- **team_war_snapshots migration = historical/champion carry ONLY** (2025 champs, seed). Its old oWAR is the pre-redesign PROJECTION
  metric — NOT a baseline for the new descriptive oWAR (it validated pWAR only). Do NOT overwrite descriptive with it.
- Dropped scratch _conf_agg (29) + _team_home_park (368) — completed-step intermediates; results already in Conference Stats / Park
  Factors; backups exist. Cleared the staging RLS advisory.
## ★★★ team_season_stats STEP 3 — RATE/COUNTING SOURCE = the authoritative MASTERS, not pitch_log (Trevor 2026-08-19)
THE QUESTION (Trevor): can team counting/rates be an aggregate of the roster's Master stats instead of pitch_log? His criterion:
"unless the Master columns were read from the pitch log and totaled … if not, the process needs to work properly in the edge function."
FINDING (scripts/import-csvs/registry.ts): Hitter Master = "Full-replace season snapshot of D1 hitter stats (TruMedia export
includes PA/AB)" — AVG/OBP/SLG/PA/AB are the TruMedia AUTHORITATIVE season export (= Baseball Reference), NOT summed from pitch_log.
Pitch_log is a SEPARATE engine with its own quantile-mapped rates (src/savant/lib/pitchLogRates.ts) that deliberately differ +
has known dedup gaps. Memory: "⚠ Master AUTHORITATIVE (=BBRef); pitch log = engine/cross-check."
DECISION: **team rate block = weighted aggregate of the authoritative MASTERS** (NOT pitch_log — the pitch-log-totaled criterion is
NOT met, so per Trevor's own logic we use the Master). EDGE-FN FIT: on upload the TruMedia CSV import (import-csvs, part of the
pipeline) populates the Masters → edge fn aggregates them into team_season_stats. Works in the one-process model.
METHOD (= "sum first, then rate"; weighting IS the summing):
- Hitting (total season): team AVG = Σ(AVG·ab)/Σab ; team OBP = Σ(OBP·pa)/Σpa ; team SLG = Σ(SLG·ab)/Σab ;
  team ISO = teamSLG−teamAVG ; team OPS = teamOBP+teamSLG ; team wRC+ = C1(teamOBP,teamSLG). Store pa_total, ab_total (authoritative Σ).
- Pitching (total season): team ERA/FIP/WHIP/K9/BB9/HR9 = Σ(rate·IP)/ΣIP (IP-weighted = ΣER/ΣIP·9 etc.). Store ip_total, bf_total.
- D1 only; ab>0 / ip>0 filter.
CAVEATS: (a) Master has TOTAL-season rates only (no reg-season rate columns; it has regular_season_pa/ip) → REG rates deferred
(Trevor: rates don't need both windows; WAR does). (b) Master lacks individual counting splits (HR/2B/3B/BB/HBP/SB/CS/SF) → those
come from pitch_log in a later pass or are skipped for v1; store the authoritative Σpa/ab/ip/bf now.
## team_season_stats STEP 3 DONE (rates, staging 2026-08-19)
Both UPDATEs 308 teams, 0 null. Team AVG/OBP/SLG = .277/.381/.434 (= D1 NCAA baselines .2777/.3823/.4365), wRC+ avg ~99-100 (center),
ERA 3.22–10.90 avg 6.16, FIP avg 5.03. Spot-check: Georgia .318/.612/wRC+120 (elite offense), Arkansas ERA 4.74 / Tennessee 4.72
(top pitching, below D1 avg), IP 497–573 (~55-game season). Authoritative-Master aggregation VALIDATED. Total-season only; reg rates
+ detailed counting splits (HR/2B/3B/BB/HBP/SB/CS/SF, from pitch_log) deferred to a later pass. SQL scripts/sql/team_season_stats_rates.sql.