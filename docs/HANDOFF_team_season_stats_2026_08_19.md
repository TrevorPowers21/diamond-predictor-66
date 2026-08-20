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
## team_season_stats STEP 4 DONE (records, staging 2026-08-19)
Records from pitch_log game outcomes. GAME KEY = DISTINCT (team_id, date, game_venue_id, total_runs, opponent_runs) — total_runs is
the game FINAL (constant per game; the 940 multi-final groups = real doubleheaders, ~3/team, split correctly on the score pair). W/L
from total_runs vs opponent_runs; 14 ties (suspended/incomplete) excluded. team_id = source_id (joins team_season_stats directly).
Boundary 2026-05-18: w_total/l_total=all, w_reg/l_reg=reg, w_conf/l_conf=REG-SEASON conference (standings — postseason/SEC-tourney
excluded). VERIFIED: 308 teams avg 55.0 games (min 37/max 71); Georgia 53-14 (23-7 SEC = 30 conf games ✓), Arkansas 41-22 (17-13 ✓).
⚠ FINDING: game_string + park_code are 0% populated on staging pitch_log (0/2.58M) — the park_code ingest backfill is STILL PENDING
(prod runbook §pitch_log_park_code). When backfilled, records could key on game_string (has game#) instead of the score-pair heuristic.
Enables wins-over-projection (future). SQL scripts/sql/team_season_stats_records.sql.
## team_season_stats STEP 5 DONE (migrate snapshot + conf context, staging 2026-08-19)
(a) Snapshot carry (308): proration_factor/games_played_est/is_national_champ/is_conference_champ/national_seed_rank from
team_war_snapshots (source_team_id=source_id). NOT the old oWAR (stale pre-redesign projection metric). ⚠ team_drs NULL — source
empty on staging (snapshot rebuilt post 2026-08-09 populate); dwar_total (the WAR) already populated; regenerate team_drs via
scripts/drs/derive_team_drs.mjs if needed. PROD: run against PROD team_war_snapshots → carries 2025 champions (LSU + 39 conf champs).
(b) Conf context (308): conf_stuff_plus/conf_htp/run_env_factor/conf_opr/conf_wrc_plus from "Conference Stats" via conference_id.
VERIFIED: 30 distinct conferences; SEC (Georgia) conf Stuff+ 105.2 / HTP 130.3 vs Ivy (Penn) 98.4 / 95.5 — correct ranking (SEC top).
SQL scripts/sql/team_season_stats_migrate_snapshot_conf.sql (2 UPDATEs, run separately).
## team_season_stats STEP 6 DONE (faced + park, staging 2026-08-19) — TABLE FULLY POPULATED
FACED semantics VALIDATED: pitch_log team_id = pitching/defense side, opponent_id = batting side (batter belongs to opponent_id ~84%
of rows). faced_stuff_plus(T) = pitch-weighted conf Stuff+ of the pitchers T's HITTERS faced (rows opponent_id=T, metric = team_id's
conf Stuff+). faced_htp(T) = pitch-weighted conf HTP of the hitters T's PITCHERS faced (rows team_id=T, metric = opponent_id's conf HTP).
Reproduces the proven Oregon State faced Stuff+ 100.2 (proof 100.3) / HTP 104.5 (proof 104.6) — method confirmed. 308/308.
PARK snapshot: rolling (rg/avg/hr9_factor) + single-season (_seasonal) from "Park Factors" (source_team_id=source_id); Park Factors
STAYS the historical source (federated). 308/308.
★ team_season_stats is now FULLY POPULATED for 308 D1 teams: keys, WAR matrix (reg+total), rates, records, snapshot/champion carry,
conf context, faced competition, park snapshot. Remaining: step 7 = fold into the ONE edge fn + repoint readers + retire team_war_snapshots.
SQL scripts/sql/team_season_stats_faced_park.sql.
## ★★★ team_season_stats — RATE SOURCE re-decision + park_code reality (Trevor 2026-08-19)
### RATE/COUNTING SOURCE → pitch_log (frequent primary), TruMedia Master = cross-check/confirm (Trevor's operational model)
- pitch_log_hitter_totals + pitch_log_pitcher_totals EXIST (per-player, keyed batter_id/pitcher_id + season + dimension_key; 'all'
  = full season, 6099 hitters / 37306 pitcher-dims). Hitter totals carry RAW COUNTS: pa, ab, hits_single/double/triple/hr, k, bb,
  hbp, sac (+ batted-ball detail, x_hits/x_bases/x_woba). BETTER than the Master (which stores rates + pa/ab only, no HR/2B/3B/BB splits).
- CROSS-CHECK (pitch-log team rates vs the Master-derived rates I stored in step 3): corr AVG 0.9957 / SLG 0.9974; MAD AVG .0012 /
  OBP .0039 / SLG .0021; pitch_log has ~16 FEWER AB/team (<1%, the dedup/missing-games gap). ⇒ Near-identical; the ~16 AB gap is
  exactly where TruMedia "confirms + corrects."
- DECISION: **rebuild the rate+counting block from pitch_log_*_totals** (matches the edge-fn cadence — pitch log is the FREQUENT feed,
  TruMedia is SPORADIC cross-check) + gains the counting splits (hr/2b/3b/bb/hbp). Keep the Master A/B as the standing cross-check.
  Step 3 currently = Master-sourced (interim, authoritative, within .001) — to be re-sourced from pitch_log in the wiring step.
  ⚠ WRINKLE: pitch_log_pitcher_totals lacks IP/ER → team ERA/FIP need the IP(=outs/3)/earned-run derivation (conf-stats ERA-via-DRS
  machinery); hitting rebuilds cleanly. WAR (step 2) is ALREADY pitch-log-native (desc_* computed from pitch_log) — no change.

### park_code / game_string — NEVER backfilled (Trevor thought it was done)
0 of 2,579,655 rows (2026; pitch_log is 2026-only) have park_code OR game_string. We added the INGEST logic (ingest_pitch_log.ts) +
validated park factors via clean team_id home/away (corr 0.996) — but the BACKFILL of park_code/game_string onto existing rows was
never run. Still the pending follow-on (prod runbook §pitch_log_park_code). Records (step 4) key on the score-pair fallback because of this.
## ★★★ EDGE-FN DATA-PATH AUDIT (Explore agent, 2026-08-19) — every piece → path clear
### THE EDGE FN = PROJECTION ENGINE, NOT descriptive
supabase/functions/process-precompute-jobs/index.ts is the ONLY edge fn (no separate unified-projection fn yet). It writes ONLY
player/build level: player_predictions (hitter: from_*/p_avg/p_obp/p_slg/p_ops/p_iso/p_wrc/p_wrc_plus/o_war/market/twp_market/
projected_pa/hitter_depth_role; pitcher: p_era/p_fip/p_whip/p_k9/p_bb9/p_hr9/p_rv_plus/p_war/market/projected_ip/roles),
team_build_players (player_snapshot JSON), team_builds, gm_budget, gm_activity, precompute_jobs. RPCs: propagate_*_scores_to_predictions,
refresh_composite_war. It does NOT write team_war_snapshots or team_season_stats. ⇒ team_season_stats is a NEW DESCRIPTIVE stage,
separate from the projection edge fn. Its pipeline: pitch_log ingest → pitch_log_*_totals (aggregate_pitch_log_dimensions.ts) →
Masters desc_* → team_season_stats. (Part of the Track B unified on-upload pipeline goal; distinct from the projection path.)

### MASTER RATES = pure TruMedia CSV (confirmed), never pitch-log, never overwritten
import-csvs/registry.ts + runner.ts: Hitter/Pitching Master AVG/OBP/SLG/ISO/ERA/FIP/WHIP/K9/BB9/HR9 = TruMedia full-replace import.
Only non-CSV writes to Masters = stuff_plus, Role, Overall Stuff+ (NOT rates). ⇒ confirms pitch_log=frequent, TruMedia=cross-check.

### PITCH-LOG PER-PLAYER STATS (the frequent rate path)
pitch_log_hitter_totals / pitch_log_pitcher_totals — RAW COUNTS, written by scripts/aggregate_pitch_log_dimensions.ts, keyed
(batter_id|pitcher_id = source_player_id, season, dimension_key; 'all'=full season). Hitter has pa/ab/hits_single/double/triple/hr/
k/bb/hbp/sac (+ battedball detail). Pitcher has total_bf/pa/ab/k/bb/hbp/hits_*_allowed (⚠ NO IP/ER → team ERA/FIP need IP=outs/3 +
earned-run derivation; Pitching Master has desc_ra9/desc_fip_ra9 as the pitch-log-native pitching rate already). App hooks already
convert counts→rates (usePitchLog2026HitterRates/PitcherRates, usePitchLogTotals).

### TEAM-AGGREGATE READERS TO REPOINT (only 4 files, all via team_war_snapshots)
src/hooks/useTeamWarSnapshots.ts (useTeamWarSnapshot L63/90/107, useWarBenchmarks L129/134, useNationalSeedBenchmark L161/167,
useAllTeamSnapshots L211/216); src/gm/pages/GMAnalytics.tsx (L77/78); src/pages/team-builder/tabs/AnalyticsTab.tsx = the Compare
tab (L46/47); types.ts:2499. Nothing reads team_season_stats yet. Script writers to retire: seed_team_war_snapshots_*.sql, team_drs_store.sql.

### park_code backfill = NEVER RUN (confirmed by agent)
Migration adds columns only; no UPDATE exists anywhere; only ingest_pitch_log.ts:319-320 writes them on NEW rows. Park factors derive
from game_venue_id, not park_code. 0/2.58M populated.

### WIRE/CLEAR PLAN
WIRE: (1) re-source rate/counting block from pitch_log_*_totals (hitting clean + splits; pitching needs IP/ER — decision pending on
2026: keep Master-final+add-splits vs switch fully to pitch-log). (2) assemble the 6 populate steps into ONE ordered team_season_stats
refresh routine (the descriptive stage). (3) repoint the 4 reader files to team_season_stats (build-check-then-clear + page-load gate).
CLEAR (after verify): retire team_war_snapshots + seed_team_war_snapshots_*.sql + team_drs_store.sql.
OPEN DECISION: 2026 rate source (Master-final+splits vs full pitch-log). Lean: keep Master-final for 2026 + add splits; pitch_log
primary for live 2027+, TruMedia reconcile.
## team_season_stats — RATE/COUNTING RE-SOURCED pitch-log-primary (staging 2026-08-19)
Trevor's operational model LOCKED: pitch log = LIVE/frequent (daily through spring); TruMedia Master = OCCASIONAL source-of-truth
fill (gaps + low-TrackMan programs not in pitch log; weekly/monthly, valid source of truth). ⇒ stored rates = pitch-log-derived,
Master reconciles/fills where thin/absent. ALSO: it's ONE edge fn — upload → collect/derive/store ALL data (Masters, pitch_log_*_totals,
team_season_stats) → run returner + transfer projections (projections depend on the stored data). team_season_stats = a STORE stage IN
that one fn, not a separate pipeline.
DONE: HITTING fully pitch-log (pitch_log_hitter_totals dim 'all' → rates + counting splits hr/2b/3b/bb/hbp/k). 308/308, corr 0.996 vs
Master, Georgia .324/.623 175HR wRC+121 (team avg unchanged .277/.434). PITCHING counting pitch-log-native (pk/pbb/phbp/phr/ph/bf);
pitch-log K9 vs Master K9 corr 0.998; Arkansas 631K/213BB/90HR. Supersedes step-3 Master-sourced hitting. SQL scripts/sql/team_season_stats_rates_pitchlog.sql.
FOLLOW-ON: full pitch-log PITCHING rates (ERA/FIP via IP=outs/3 + ER derivation — conf-stats machinery); Master-reconcile/fill logic (COALESCE, no-op for 2026 D1).
## ★ team_season_stats WIRE B DONE — ONE idempotent routine (staging 2026-08-19)
refresh_team_season_stats(p_season int, p_reg_end date DEFAULT <season>-05-18) — plpgsql fn, migration
20260819010000_refresh_team_season_stats.sql. DELETE season → rebuild via 10 sub-steps (base+WAR Σ Masters; hitting rates+counting
splits from pitch_log_hitter_totals; pitching counting from pitch_log_pitcher_totals; pitching rates Master IP-weighted; records from
pitch_log; snapshot carry; conf context; faced_stuff_plus/faced_htp; park snapshot). Idempotent + season-parameterized. This is the
descriptive STORE STAGE the unified upload edge fn calls (RPC) after Masters + pitch_log_*_totals refresh, before/around projections.
VALIDATED: select refresh_team_season_stats(2026) → 308 rows; reproduces EVERY verified number (pWAR corr 1.0000, team .277/.434,
Georgia 53-14 (23-7), OSU faced 100.2/104.5, 308 fully populated). NEXT: WIRE C repoint the 4 readers (useTeamWarSnapshots/GMAnalytics/
AnalyticsTab/types) to team_season_stats + page-load gate; then CLEAR retire team_war_snapshots + seed scripts (build-check-then-clear).
## ★ team_season_stats CONSOLIDATION COLUMNS (Trevor decisions 2026-08-19) — replaces team_war_snapshots' comparison structure
Compare card (TB Analytics + GM Analytics) = prior-season DESCRIPTIVE team WAR vs current-build PROJECTED roster WAR, side by side.
4 cells refreshed to DESC WAR, REGULAR-SEASON basis (NO proration — Trevor: reg-season total more accurate than the old 56-game prorate):
- **Hitter WAR = full team o+d+bsr** (hitter_war_reg = Σ hitter total_desc_war). REPLACES the old "Lineup oWAR (top-9)" cell. ⚠ Coordinated
  frontend change: the current-build side (GMAnalytics.tsx:65 gm.hitters.slice(0,9) oWAR; AnalyticsTab buildLineupOwar) must switch from
  top-9 oWAR → all-hitters o+d+bsr, and the label "Lineup oWAR" → "Hitter WAR". Nothing removed — the cell just measures full hitter value.
- **Rotation pWAR** (rotation_pwar_reg) + **Bullpen pWAR** (bullpen_pwar_reg) — KEPT (Trevor). rotation = top-3 pitchers by IP, bullpen = rank 4+.
- **Total WAR** (total_war_reg = hitter+rotation+bullpen).
Columns added: hitter_war_reg/total, rotation_pwar_reg/total, bullpen_pwar_reg/total. Folded into refresh_team_season_stats() (step 1 +1b).
VALIDATED: rotation+bullpen=pwar (0 mismatch), hitter_war=o+d+bsr (0 mismatch); Georgia 24.0hit/7.0rot/6.1bp/37.1tot, Arkansas 10.8/5.9/7.3.
TOP-9 USAGE (answer to Trevor): the top-9 lineup oWAR is 1 of 4 comparison cells in TB Analytics (Year-over-Year + Championship Benchmark +
National Seed Range) AND GM Analytics — current-build side computes it live (slice(0,9)), prior-year side reads the snapshot. Switching to
full-team hitter WAR changes BOTH sides + the label; it's a deliberate swap, not a break.
NEXT (WIRE C frontend): repoint useTeamWarSnapshots.ts + GMAnalytics.tsx + AnalyticsTab.tsx + types.ts to team_season_stats (_reg cells);
change current-build hitter calc top-9→full-team o+d+bsr; relabel; page-load verify. Then CLEAR retire team_war_snapshots + seed_team_war_snapshots_*.
## ★★★ team_season_stats — RETIRE + HITTER-WAR decisions (Trevor 2026-08-19)
### DO NOT RETIRE team_war_snapshots — FEDERATE BY ERA
team_season_stats is descriptive-FROM-pitch_log, and pitch_log is 2026-ONLY (no 2025 pitch_log → 2025 descriptive WAR is
IMPOSSIBLE to compute). Prod's team_war_snapshots 2025 rows (LSU natl champ + 39 conf champs + the prior-year WAR the current 2026
build compares to) are the ONLY source of 2025 team WAR and CANNOT be regenerated. ⇒ KEEP team_war_snapshots as the pre-pitch-log
HISTORICAL store; team_season_stats = canonical for 2026+ (seasons with pitch_log). Readers: team_season_stats for 2026+, fall back
to team_war_snapshots for 2025. Same federate-by-era principle as keeping "Park Factors". **The "CLEAR/retire team_war_snapshots"
step is REMOVED** — no data loss, 2025 is frozen. (Step 5 still CARRIES champion flags/seed into team_season_stats 2026 rows for teams present.)

### HITTER WAR — PIVOT everywhere: "Starting Lineup oWAR" (top-9) → "Full-team desc Hitter WAR" (o+d+bsr, ALL hitters)
Trevor: total hitter war (o+d+bsr) not just oWAR, full team (whole roster) not top-9, for consistency. REPLACE, not keep-both.
- Prior-season side = team_season_stats.hitter_war_reg (= Σ hitter total_desc_war = o+d+bsr — already built).
- Current-build side = projected FULL-TEAM hitter WAR (all hitters' projected o+d+bsr) — REPLACES GMAnalytics.tsx:65 gm.hitters.slice(0,9)
  oWAR + AnalyticsTab buildLineupOwar/starterTotalOwar. Relabel "Starting Lineup oWAR"/"Lineup oWAR"/"Δ Lineup" → "Hitter WAR".
- Comparison = full-team desc hitter WAR (prior) vs projected full-team hitter WAR (current). NO starting_lineup_owar column needed (hitter_war is it).
- Hero strip (AnalyticsTab:827-838) headline pivots to full-team hitter WAR; the position-tier lineup display below (:840-857) stays (current-build starters by position).
FRONTEND (WIRE C, page-load gated): useTeamWarSnapshots.ts (add team_season_stats source, era fallback) + GMAnalytics.tsx (hitter calc + labels)
+ AnalyticsTab.tsx (starterTotalOwar/buildLineupOwar → full-team hitter WAR + labels) + types.ts. Reg-season desc basis, no proration.
## team_season_stats PITCHING RATES → pitch-log-primary (staging 2026-08-19)
Trevor's outs-tracking IP method (track outs column transitions per half-inning, not atbat_desc parsing) UNLOCKED pitch-log pitching
rates. refresh_team_season_stats() step 4a/4b:
- IP = Σ(max(outs)+1)/3 over pitching half-innings (game key incl score-pair for DH split). corr 0.9932 vs Master IP.
- K9/BB9/HR9 = pitch-log counts (pk/pbb/phr from step 3) ×9 / IP. WHIP=(pbb+ph)/IP. FIP=(13·phr+3·(pbb+phbp)−2·pk)/IP + 3.157 (cFIP D1 2026).
- ERA = Master IP-weighted (SOURCE-OF-TRUTH). Pitch-log ERA = 0.825 corr (earned-run attribution via runs−(UR) is imperfect — inherited
  runners/errors), so ERA stays official. K9/BB9/HR9/WHIP corr 0.996+; FIP mean matches Master.
VERIFIED: 308/308, 0 null; Arkansas IP 532/K9 10.7/FIP 4.48/ERA 4.74; D1 avg IP 465 (smaller programs)/K9 8.33/FIP 5.03/ERA 6.16.
ERA-source (Master) is the documented recommendation; overridable to pitch-log ERA if Trevor prefers. Hitting already pitch-log (step 2);
Master-reconcile fill (step 2b) fills hitting from Master where pitch-log absent (no-op 2026 D1). FOLLOW-ON remaining: reg-window pitch-log rates; park_code backfill.
## ★★★ SESSION STATE + WHAT'S-NEXT PLAN (2026-08-19)
### DONE this session (staging, all verified + committed)
- team_season_stats table (117+ cols) + refresh_team_season_stats(season) — ONE idempotent routine, the descriptive STORE stage of
  the unified upload edge fn. Rebuilds: WAR matrix (Σ Masters desc_*), hitter_war (o+d+bsr) + rotation/bullpen split, hitting
  rates+counting (pitch-log-primary), pitching counting (pitch-log), pitching rates (outs-tracking IP + K9/BB9/HR9/WHIP/FIP
  pitch-log; ERA=Master source-of-truth), records (pitch-log outcomes), conf context, faced_stuff_plus/htp, park snapshot,
  snapshot/champion carry, Master-reconcile fill. 308 D1 teams; every block A/B-verified.
- Decisions locked: pitch-log-primary rates (Master=occasional source-of-truth fill); federate-by-era (team_war_snapshots KEPT for
  2025 — unrecomputable; team_season_stats canonical 2026+); hitter-WAR pivot (Lineup oWAR→full-team Hitter WAR everywhere); ERA=Master.
- pitcher_full_name CORRUPTION fixed (was = batter name): backfilled from pitcher_id→players real name (each pitcher_id now 1 name). Ingest fix pending.
- park_code/game_string backfill RUNNING (from DRS CSVs; saved big-write process).

### IN FLIGHT
- park_code UPDATE (background, saved process) → verify + RESTORE role timeout to 2min.
- WIRE C frontend repoint (agent) → review diff + tsc + PAGE-LOAD verify the 2 Compare cards.

### WHAT'S NEXT (ordered)
1. FINISH park_code: verify ~2.58M populated; RESTORE role statement_timeout='2min'; rebuild pitch-log park factors keyed by
   park_code+team_id; re-key records/outings on game_string (fixes DH merges + the 2 pitch-count artifacts). Drop _park_code_fix + fix_parkcode.
2. FINISH WIRE C: review agent diff, tsc clean, PAGE-LOAD both Compare cards (TB Analytics + GM Analytics), commit. NO retire (federate by era).
3. team_season_stats finish (optional): DRS-accurate ra9 rollup (desc_ra9), reg-window pitch-log rates.
4. INGEST FIXES: ingest_pitch_log.ts pitcher_full_name mapping (maps CSV 'fullName'=batter → wrong); park_code ingest logic already correct.
5. PROD PUSH — the team_season_stats system (per PROD_MIGRATIONS_TODO §team_season_stats): CREATE table + refresh fn + call per season;
   pitcher_full_name backfill (build _pitcher_name_fix from prod + fix_pnames loop); park_code backfill (load CSVs → _park_code_fix →
   raised-timeout UPDATE); + the queued park/conf/is_conf/HTP/Bucket-A migrations. Via Trevor's PR/paste flow (staging→main).
6. RESUME THE MAIN GOAL — the ONE edge fn / projection pipeline. team_season_stats is a store stage of it. Pre-edge-fn punch list
   remaining: #5 position-of-need, #6 transfer-engine sync (3 copies), #7 dead-code audit → edge fn 6b projections → 7c snapshots
   (fixes TB oWAR regression) → NIL wiring. See docs/HANDOFF_STUFF_PLUS_2026_08_16 + transfer-engine audit.
## ★ WIRE C (team_season_stats frontend repoint) — STASHED INTO THE EDGE-FN / LIVE-COMPUTE-REPOINT PHASE (Trevor 2026-08-19)
Do NOT do a partial repoint now — the current-build side needs a snapshot/edge-fn change, so the whole pivot goes with the
"repoint all live-compute display spots" work (§LIVE-COMPUTE ELIMINATION / edge-fn phase). Full spec + findings (so that phase doesn't re-investigate):

### 4 files to change
- src/hooks/useTeamWarSnapshots.ts — hooks useTeamWarSnapshot(L63), useWarBenchmarks(L129), useNationalSeedBenchmark(L161),
  useAllTeamSnapshots(L211). FEDERATE BY ERA: season>=2026 read team_season_stats; season<2026 keep team_war_snapshots (2025 unrecomputable).
- src/gm/pages/GMAnalytics.tsx — current-build calc L65 (lineupOwar=hitters.slice(0,9).war), rotation/bullpen L63-64, deltas L214/223, label L185.
- src/pages/team-builder/tabs/AnalyticsTab.tsx — hero strip "Starting Lineup oWAR" L827-838 (starterTotalOwar/priorYearLineupDelta),
  benchmark "Lineup oWAR"/"Δ Lineup" L337/369, prorated_starting_lineup_owar reads L386/781, slice(0,9) L185.
- src/integrations/supabase/types.ts — add team_season_stats Row type (~L2499 near team_war_snapshots).

### Field mapping (REG-season basis, NO proration)
prior raw/prorated_starting_lineup_owar → hitter_war_reg ; rotation_pwar → rotation_pwar_reg ; bullpen_pwar → bullpen_pwar_reg ;
total → total_war_reg ; carry is_national_champ/is_conference_champ/national_seed_rank. Drop proration (use _reg directly).

### Hitter-WAR pivot (RELABEL "Lineup oWAR"/"Starting Lineup oWAR"/"Δ Lineup" → "Hitter WAR"/"Δ Hitter")
- Prior-season side = team_season_stats.hitter_war_reg (full-team o+d+bsr).
- ⚠ CURRENT-BUILD side BLOCKER: gm roster row.war = the player_snapshot's o_war (oWAR ONLY) — snapshot at process-precompute-jobs/
  index.ts:1729/1753 stores {..., o_war, ...}; the hPred query L1672 selects o_war but NOT d_war/bsr_war/total_hitter_war. player_predictions
  HAS o_war/d_war/bsr_war/total_hitter_war/p_war (composite via refresh_composite_war L1885). ⇒ to make the current build = full-team
  hitter WAR (o+d+bsr), PLUMB total_hitter_war INTO the hitter snapshot (add to L1672 select + L1729/1753 snapshot) + RE-PRECOMPUTE, and
  change useGmRoster to read total_hitter_war (or the AnalyticsTab build calc). Then both sides = o+d+bsr, consistent. Pitching keeps rotation/bullpen split.
- Until then: current-build stays oWAR — which is WHY we don't do a partial repoint (would show o+d+bsr prior vs oWAR current = mismatch).

### Verify: tsc -p tsconfig.app.json (no NEW errors in touched files) + PAGE-LOAD both Compare cards (Trevor can view). NO table retire (federate by era).
## ★★★ NEXT-PHASE PLAN + CLARIFICATIONS (Trevor 2026-08-20)
### park_code / neutral sites — NOT just polish (Trevor correction)
The team_id home/away park-factor method does NOT pick up NEUTRAL-SITE games (a neutral game is "home" for neither team → the
home/away filter misses it entirely). park_code keys by the ACTUAL STADIUM regardless of home/away, so it's REQUIRED to capture
neutral-site park effects (regionals, MLB-park showcases, tournaments). ⇒ after park_code fills, re-derive pitch-log park factors
keyed by park_code (+ team for the batting context) so neutral sites are attributed to the right park. Also re-key records/outings on game_string.

### PROD PUSH — LOG EVERYTHING, do NOT push yet (Trevor)
We are NOT pushing to prod yet. Keep logging EVERY schema/SQL/backfill change to PROD_MIGRATIONS_TODO.md (the whole team_season_stats
system + name/park_code backfills + queued park/conf/is_conf/HTP/Bucket-A migrations). The push happens later via Trevor's PR/paste flow.

### DO THESE NOW (Trevor: "yes do this")
1. DRS-accurate ra9 rollup — team ra9 from Master desc_ra9 (IP-weighted) = the accurate pitch-log run-prevention rate (ERA stays Master).
2. Reg-window pitch-log rates — add _reg variants of the pitch-log rates (currently total-season only).
3. ingest_pitch_log.ts pitcher_full_name mapping fix — it maps CSV 'fullName' (= the batter) into pitcher_full_name; fix so new ingests are correct.

### #5 POSITION-OF-NEED — SETTLED ("I like it", handoff L461-516). is_position_of_need = true/false flag: read the ACTIVE build →
per-player, if the p70 at that position isn't a starter (a need exists) → true. STORED next to dev_aggressiveness (build player meta);
re-run the check + update the flag on EVERY SAVE (roster-reactive, NOT live). transfer_snapshot→player_snapshot. Automatic+stored+roster-reactive now; coach questionnaire later. Design is done — just needs building.

### #6 TRANSFER-ENGINE SYNC — the transfer PROJECTION engine exists in 3 DRIFTED copies: canonical src/lib/*, the Deno edge fn
(process-precompute-jobs, a hand-mirror), and the TB live hook. They've diverged. Confirmed bugs: edge fn still applies pitcher PVF
(weekend-SP premium, index.ts:672) while canonical DROPPED it (→ SP transfer market ~20% high); triple-oWAR leftover (delete). #6 =
sync all 3 to canonical (strip edge-fn PVF, delete triple-oWAR, align rate-index/lgRA9). [[project_transfer_engine_audit]]. It's a CODE-consistency fix.

### #6 vs 6b vs #7 vs "finalize the edge fn" (Trevor's question)
- #6 = FIX/sync the transfer engine CODE (3 copies → canonical). #7 = DEAD-CODE AUDIT (Savant clear, dead park_factors drop, V1 conf
  retire, corrupted-col DROP, scratch drops). 6b = RUN the transfer projections (deploy the synced edge fn + FIRE transfers + A/B verify BOTH sides).
- So: #6 fixes the code → #7 removes dead code → 6b actually runs the transfer projections → 7c snapshots (fixes TB oWAR regression) → NIL.
- "Finalize the WHOLE edge function" = the Track B UNIFIED on-upload edge fn that collapses the 3 copies into ONE process (upload →
  collect/derive/store all data incl team_season_stats → run returner + transfer projections). That's the end state; 6b is a step toward it.
- WIRE C (team_season_stats frontend repoint + total_hitter_war snapshot plumbing) rides with 6b/7c.
## ★★★ BRANCH STRATEGY (Trevor 2026-08-20) — prod-push improvements FIRST, then edge-fn rework on a fresh branch
### "canonical" = the main SOURCE-OF-TRUTH version of the code (the reference impl the others match). Currently src/lib/* is canonical;
the edge fn is a hand-written Deno MIRROR that drifted. ⇒ "sync to canonical" = make the edge fn match the correct src/lib.
### TB live hook = TEMPORARY UI PREVIEW that reverts to the stored DB value on save (Trevor: "really important to remember"). NOT a
persistent engine → #6 is really only TWO persistent things (canonical src/lib + edge fn), and the edge fn is THE one that runs.
END STATE = ONE engine: the edge fn + app IMPORT THE SAME SHARED LOGIC so drift is impossible (Track B unification makes #6 mostly disappear).

### PHASE 1 — get ALL data+code improvements into PROD (current feature/war-recalibration branch)
Self-contained, verified, doesn't destabilize (team_season_stats is a store stage nothing reads yet; data fixes are pure quality).
Includes: team_season_stats + refresh_team_season_stats() + name backfill + park_code backfill + pitch-log pitching rates + park
factors + conf-stats/HTP + is_conf + BUILD #5 position-of-need + the 3 do-items (ra9, reg-window, ingest pitcher_full_name fix).
⚠ LARGE push = the whole war-recalibration accumulation (desc_* cols → model_config → pitch_log_totals → Conference Stats →
team_season_stats). DEPENDENCY ORDER MATTERS — assemble the ordered prod runbook from PROD_MIGRATIONS_TODO.md. Trevor drives staging→main PR.

### PHASE 2 — edge-fn rework on a FRESH branch off the new main
Unify the engine (edge fn imports the shared lib → no drift), plumb total_hitter_war into the snapshot, run transfer projections (6b)
+ A/B BOTH sides, land WIRE C (frontend repoint + hitter-WAR pivot), snapshots (7c, fixes TB oWAR regression), NIL. Verify in
isolation, clean up, then merge. The risky part — isolated on its own branch.

### NEXT ACTIONS (Phase 1 build order)
1. Build #5 position-of-need (is_position_of_need flag + storage + save-hook re-check) + verify functionality.
2. DRS ra9 rollup + reg-window pitch-log rates (refresh_team_season_stats additions).
3. ingest_pitch_log.ts pitcher_full_name mapping fix.
4. Finish park_code (fill + park-factor re-derive on park_code for neutral sites + records/outings re-key on game_string).
5. Assemble the ordered prod runbook. (Do NOT push — Trevor drives.)
## ★★★ PHASING REFINEMENT (Trevor 2026-08-20) — Phase 1 = FINALIZE + WIRE everything + SHIP; Phase 2 = edge-fn CLEANUP only
Correction to the earlier "WIRE C stashed to Phase 2": Trevor wants ALL the new/correct/improved data WIRED everywhere it's needed
and SHIPPED (stored + used) IN THIS PUSH — not left as unwired tables. Then a FRESH branch ONLY for the edge-function cleanup/unification.

### PHASE 1 (current branch) — finalize data calcs + WIRE the improvements into every read/display + ship stored properly
- team_season_stats + refresh routine (done) + WIRE C BACK IN (repoint Compare cards to team_season_stats era-fallback + hitter-WAR
  pivot + relabel) + descriptive WAR columns on Masters + position-of-need (#5) + park/records/rates displayed. App SHOWS correct improved data.
- ⚠ ONE SEAM: WIRE C's CURRENT-BUILD hitter cell needs total_hitter_war in the player_snapshot (edge-fn-written). Phase 1 does a
  MINIMAL TARGETED addition: add total_hitter_war to the hitter snapshot (process-precompute-jobs index.ts:1672 select + :1729/:1753
  snapshot) + re-precompute — NOT the structural refactor. Then WIRE C fully lands (both sides o+d+bsr).
- Data do-items: DRS ra9 rollup, reg-window pitch-log rates, ingest pitcher_full_name fix, park_code finish (+ park factors on
  park_code for neutral sites + records/outings re-key on game_string). Assemble ordered prod runbook. Trevor drives staging→main PR. DO NOT push.

### PHASE 2 (fresh branch off new main) — ONLY the edge-function structural cleanup/unification
Collapse the copies into ONE shared engine (edge fn + app import the same lib → drift impossible), #6 transfer-sync structurally,
DEAD-CODE audit, Track B one-process (upload → collect/store all incl team_season_stats → run returner+transfer projections), clean
transfer re-run (6b) + A/B. The risky architectural refactor — isolated, verified, cleaned up, then merged.
## PHASING CONFIRMED + PARK-FACTOR FINDING (Trevor 2026-08-20)
- PHASE 2 = the EDGE FUNCTION ALONE (structural cleanup/unification). EVERYTHING ELSE = PHASE 1: all display + wiring — WIRE C,
  #5 position-of-need, the minimal total_hitter_war snapshot touch, descriptive WAR columns, records re-key. (#5 is display+wire → Phase 1.)
- PARK FACTORS were derived off the HOME FLAG (scripts/sql/park_home_2026.sql: "a team's park = all its home games", keyed team_id) —
  NOT park_code (was null). But home-flag IS effectively park-based: a team's home games = games at their park → the factor = the
  park factor. All 308 HOME parks already correct. GAP = true NEUTRAL sites only: 310 park_codes vs 308 teams = ~2 dedicated neutral
  venues → a handful of tournament games not attributed to any park factor. MINOR. ⇒ re-deriving on park_code is nice-to-have
  (nudges the ~2-park neutral delta + proper keying), NOT urgent. THE REAL park_code PAYOFF = game_string → exact game identification
  for RECORDS/OUTINGS (fixes doubleheader merges + the 2 pitch-count artifacts). That's the substantive DB-batch win.
- FRONTEND WORKFLOW (Trevor's "what do I need to do"): agent writes ALL code + tsc-checks, then hands Trevor a per-page CHECKLIST
  (open page X → confirm card/number Y). Trevor just page-loads + eyeballs. That IS the whole page-load gate.
## park_code PAYOFF DELIVERED — records on game_string (staging 2026-08-20)
refresh_team_season_stats step 5 now keys games on game_string (cs-<park><date8><game#> = exact game id, DH-safe) instead of the
score-pair heuristic. Records unchanged (Georgia 53-14 (23-7), Arkansas 41-22, avg 55 games = consistent) but now EXACT. Same
game_string is available for any per-pitcher outing analysis → the Ohman(502)/Beaty(345) merge artifacts resolve when keyed on game_string.
REMAINING PHASE-1 DB batch: DRS ra9 rollup, reg-window pitch-log rates, ingest_pitch_log.ts pitcher_full_name fix.
REMAINING PHASE-1 FRONTEND: #5 position-of-need wiring (positionNeed.ts built, wire stored-not-live), WIRE C (Compare cards + hitter-WAR pivot + total_hitter_war snapshot touch).
## PHASE-1 DB BATCH (staging 2026-08-20)
1. DRS ra9 + reg-window pitching — DONE. refresh step 4c: ra9_total/ra9_reg/fip_ra9_total/fip_ra9_reg from Master desc_ra9/_reg
   (IP-weighted; DRS-accurate run prevention). avg RA9 6.36 > ERA 6.16 (unearned). Covers reg-window PITCHING (+ WAR already reg-split).
2. Reg-window RATE SET (avg/obp/slg/era/k9 etc) — pitch_log_*_totals are 'all'-dimension only, so the full reg-window rate set needs
   a 'reg' dimension added to aggregate_pitch_log_dimensions.ts (+ re-run) OR a raw date-filtered pitch_log aggregation. SEPARATE
   follow-on (heavier). Delivered so far: WAR reg/total + RA9 reg/total.
3. INGEST pitcher_full_name — RE-DIAGNOSED: DRS CSVs have fullName=PITCHER (correct); ingest mapping is fine for that format. Original
   corruption = a different/older source. ROBUST FIX = standard post-ingest resolve pitcher_full_name from pitcher_id (fix_pnames).
   ⚠ VERIFIED via proper quote-aware parse (112-col CSV with comma-fields breaks naive comma-split — always use a quote-aware parser).
## ★★★ RE-PRIORITIZED (Trevor 2026-08-20): CORRECT VALUES → STORE → DISPLAY → then (wiring stage) position-of-need
Order: get correct transfer values → store → display, THEN worry about functions/storing like position-of-need. #5 position-of-need
MOVED to the wiring stage (later). Input-mapping-from-correct-sources = part of the whole edge function.

### TRANSFER-FUNCTION CORRECTNESS (Phase 1, the real work)
1. #6a PVF — DONE (stripped e5fe955; market_pvf_weekend_sp:1.2 @ index.ts:533 is a DEAD constant, cleanup only).
2. #6b oWAR TANGLE (revised — NOT a dead-line delete): the DISPLAY reads transferProjection.owar (hardcoded 260-PA @
   transferProjection.ts:124) while the STORED path uses depth-role PA (computeHitterOWar) → they DISAGREE. Consumers of the 260-PA
   owar: PlayerTableRow.tsx:174, AnalyticsTab.tsx:138/172/184/626, useTeamBuilderSimulation. FIX = reconcile display→depth-role oWAR.
3. ★ SD AUDIT (Trevor's added point — the crux) [[project_stuff_opr_sd_audit]]: the projection scales each conference/competition/park
   delta by an SD constant. transferPitcherProjection.ts projectLower/projectHigher args include era_pr_sd, era_plus_ncaa_sd, +
   competition_weight×HTP, park_weight×rg. Those *_sd live in eq (transferWeightDefaults.ts / model_config), DERIVED FROM OLD DATA.
   We recomputed Stuff+, park factors, HTP, conf rates, power ratings → their SDs SHIFTED → the eq *_sd are STALE → every lever
   mis-weights. RE-DERIVE all *_sd (PR SDs, plus-NCAA SDs, HTP SD, park rg SD, Stuff+ SD) off CURRENT data → update eq. GATES correctness.
4. INPUT MAPPING — point competition/env at the corrected team_season_stats faced Stuff+/HTP + park (part of the edge fn).
Weight config: src/lib/transferWeightDefaults.ts + model_config. Equation core: src/lib/transferPitcherProjection.ts (pitcher),
transferProjection.ts (hitter). OPEN (confirm w/ Trevor before touching): SD populations/filters; oWAR-reconcile target = depth-role.

### PHASE 2 = edge-function STRUCTURAL cleanup ALONE (unify copies → one shared lib, dead-code). Outputs unchanged.
## ★★★ SD AUDIT — METHODOLOGY FOUND + PLAN (Trevor 2026-08-20). DO NOT restructure env+ (100-avg scale is fine); ONLY audit the SD that scales each lever's weight.
### env+ formula IS in the code (src/lib/powerRatings.ts) — no reconstruction needed:
- eraPrPlus = (eraRaw/50)*100  (:320) — direct scale to 100-average
- hr9PrPlus/k9PrPlus/bb9PrPlus = (raw/50)*100  (:350 etc.)
- fipPrPlus = WEIGHTED COMPOSITE of hr9PrPlus+bb9PrPlus+k9PrPlus (FIP_WEIGHTS) (:352-359) — different spread BY CONSTRUCTION (composite, not a single /50*100)
- overallPrPlus = (eraPrPlus+fipPrPlus)/2  (:361). Hitter: baPlus/obpPlus/isoPlus/overallPlus (:145-151).
### WHY SD grew (Trevor): we REMOVED the old ×20 pitching consistency scale to make ONE consistent equation for hitter AND pitcher
(didn't have that before). So the pitching env+ now sits on a wider scale → cross-conf SD legitimately LARGER than the stored 2026-05
values (era+ 9.4/fip+ 6.2/etc). REAL change, not a formula mismatch. It's on THIS push-to-prod, so the equation change is already in.
### THE WEIGHT MECHANISM (transferWeightDefaults.ts + model_config): conference_weight = 0.025 × D1_cross-conf_SD (≈2.5%/SD);
competition_weight = 0.05 × HTP_SD (≈5%/SD, HTP dominant). Stored SDs (now stale): era+ 9.4·fip+ 6.2·whip+ 5.3·k9+ 7.9·bb9+ 8.6·hr9+ 17.3·HTP 14.1.
### DRIFT CHECK (D1 cross-conf, current): HTP SD 14.3 (≈ stored 14.1 → the DOMINANT competition lever is STABLE). Pitching env+ SDs grew
(from the ×20 removal). ⚠ FILTER: D1 only — the 40-vs-30 conf gap likely includes JUCO; audit must exclude JUCO. Full-season values (not reg regulars).
### DELIVERABLE (Trevor confirmed format): one table BOTH hitting + pitching, D1-only —
| Stat | env+ SD (now) | % impact (now) | old weight | recommended weight |
Compute cross-conf SD of the CURRENT env+ (per powerRatings.ts formula) → recommended weight = 0.025×SD (conf) / 0.05×SD (competition/HTP).
Trevor approves before any weight changes. Config lives in transferWeightDefaults.ts (JUCO) + model_config (D1). ⚠ Trevor will point to
the EXACT weight/SD from the equation — confirm which projectLower/projectHigher SD arg (era_pr_sd vs era_plus_ncaa_sd vs conf-delta SD) is the target.

### ALSO (this session, for the record): oWAR reconcile = drop 260-PA, use DEPTH-ROLE PA (auto-filled) + defensive IP by role +
pitching IP by role; scale WAR by role PA/IP in BOTH storage + display; 1-for-1 but live-reactive to toggle/role changes (belongs in the
projection engine). PVF already stripped (e5fe955; dead constant @ index.ts:533). #5 position-of-need → moved to WIRING stage (later).
Re-priority: correct values (transfer #6 + SD audit + input mapping) → store → display → then wiring-stage functions.
## ★★★ SD AUDIT — STORAGE GAPS (Trevor 2026-08-20): env+ scale CONFIRMED consistent; 2 things must be STORED not live/hardcoded
### CONFIRMED: env+ all on the /50*100 100-average scale (powerRatings.ts). FIP+ = weighted avg of hr9+/bb9+/k9+ (each /50*100) → lands
on 100-scale. 132 = 32% above avg, real. ×20 pitching multiplier REMOVED → one consistent equation hit+pitch → pitching env+ now wider
scale → cross-conf SD legitimately larger than the stored 2026-05 values. DO NOT touch env+.
### GAP 1 — per-conference PITCHING env+ NOT stored. Conference Stats stores HITTER env+ (ba_plus/obp_plus/iso_plus/slg_plus/
hitter_talent_plus/Stuff_plus) + Overall_Power_Rating (SEC 119.4) but NOT the individual era+/fip+/whip+/k9+/bb9+/hr9+ per conference —
those are LIVE-computed in the projection. Trevor: they SHOULD BE STORED (Conference Stats columns + conference-page display), stored-not-live.
### GAP 2 — the SDs themselves (the audit target) are HARDCODED in a transferWeightDefaults.ts COMMENT (era+ 9.4·fip+ 6.2·whip+ 5.3·
k9+ 7.9·bb9+ 8.6·hr9+ 17.3·HTP 14.1). Must be TRACKED/STORED (a real config row) so weights derive from a stored auditable source, not a
stale comment. SD = CONFERENCE-to-conference (cross-conf) SD (Trevor: "conference to conference impact so it is conference SD").
### AUDIT = 3 pieces: (1) compute+store per-conf pitching env+ (/50*100) in Conference Stats + display; (2) compute+store the cross-conf
SDs (hit+pitch, D1-only JUCO-excluded, full-season) as tracked config replacing the hardcoded comment; (3) table Stat|env+ SD now|% impact
now|old weight|recommended weight → weights = 0.025×SD (conference) / 0.05×HTP_SD (competition). Trevor approves before weight changes.
### OPEN (confirm w/ Trevor): where to STORE the SDs (model_config vs dedicated SD config table); pitching env+ as new Conference Stats columns.
### SAMPLE (SEC, D1): HTP 130.3, iso_plus 119.3, ba_plus 94.3, Overall_Power_Rating(pitch) 119.4, offensive_power_rating NULL (also a gap — hitting overall PR not stored at conf level).
## ★★★ CONFERENCE STATS STORAGE AUDIT (Trevor 2026-08-20) — more gaps than just pitching env+
Coverage (D1, 40 conference rows): Stuff+ 40/40 · Overall_Power_Rating(pitch) 40/40 · ba_plus 40/40 ✓. GAPS:
- HTP (hitter_talent_plus) 30/40 · WRC_plus 30/40 · run_env_factor(park) 30/40 → 10 conferences MISSING these.
- offensive_power_rating (hitting OPR) 0/40 → NEVER stored.
- pitching per-stat env+ (era+/fip+/whip+/k9+/bb9+/hr9+) → NO COLUMNS (live-computed only).
- Park per conf = only run_env_factor.
⇒ 40-vs-30 SD-POPULATION ISSUE: 40 D1 rows but only 30 fully populated → the 10 partial confs drag the cross-conf SD. MUST resolve
(fill the 10 or exclude from D1) before the SD numbers are trustworthy. OPEN — Trevor to decide: fill the 10 or exclude.
STORAGE BUILD (all Trevor-confirmed): (1) fill EVERY per-conf gap — pitching env+ (new Conference Stats columns, /50*100), hitting OPR,
+ the 10 missing HTP/WRC/park; (2) store cross-conf SD per metric in model_config + admin display (informational; the 0.025×SD WEIGHT is
what's used + is saved/displayed in multiple spots — store SDs "for consistency"); (3) LOG the edge fn to UPDATE all of these ON UPLOAD
(stored-not-live); (4) the audit table (Stat|env+ SD now|% impact|old weight|recommended weight, both hit+pitch) after population is clean.
Trevor: "make sure HTP, Stuff+, Park factor, OPR, and the other metrics per conference are stored in Conference Stats."
## ★★★ % IMPACT FORMULA (transferPitcherProjection.ts projectLower/projectHigher) — CALCULATE, don't assume (Trevor 2026-08-20)
projected = blended × (1 − confTerm + compTerm + parkTerm), where:
  confTerm = confWeight × ((toConfEnv+ − fromConfEnv+)/100)   [conference lever]
  compTerm = compWeight × ((toHTP − fromHTP)/100)             [competition/HTP lever]
  parkTerm = parkWeight × ((toPark − fromPark)/100)           [park lever]
  (powerAdj = ncaaAvg ∓ ((prPlus−100)/prSd)×ncaaSd ; blended = last×(1−powerWeight)+powerAdj×powerWeight)
⇒ A lever's % IMPACT for a 1-SD conference difference = weight × (SD/100). (For HTP: compWeight × SD_HTP/100 — CALCULATE with the
real D1 compWeight + real SD, do NOT assume "5%".) Recommended weight per methodology: conference = 0.025 × SD ; competition = 0.05 × SD.
D1 EQUATION ONLY — ignore all JUCO weights (JUCO_PITCHING_TRANSFER_WEIGHTS etc.). D1 weights live in model_config (DB).

## D1 cross-conf SDs (30 real D1 confs, JUCO NJCAA-D1 excluded) measured 2026-08-20:
HTP 14.31 (stored 14.1 → STABLE) · Stuff+ 3.48 · ba+ 3.91 · obp+ 3.47 · iso+ 12.47 · slg+ 5.94 · wRC+ 3.41 · OPR(pitch) 7.99.
Pitcher per-stat env+ (era+/fip+/whip+/k9+/bb9+/hr9+) NOT stored → COMPUTE (/50*100 on conf pitcher scores) + STORE in Conference Stats
(new columns) + display + edge-fn updates on upload. Also fill offensive_power_rating (hitting OPR, 0/40). The 40-vs-30 = the 10 NJCAA-D1
districts (JUCO) mislabeled division='D1' — EXCLUDE from D1 SD (leave JUCO untouched, not needed now).

## PLAN (all D1, stored-not-live): (1) compute+store per-conf pitcher env+ + hitting OPR in Conference Stats + edge-fn-on-upload;
(2) compute+store the cross-conf SDs (config, e.g. model_config, + admin display — informational; the derived WEIGHT is used + saved
in multiple spots); (3) table Stat | SD now | % impact (=weight×SD/100) | old weight | recommended weight (=0.025×SD conf / 0.05×SD comp)
for Trevor approval before any weight change. Config: model_config (D1 weights) + transferWeightDefaults.ts.