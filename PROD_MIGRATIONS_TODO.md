# Prod migration checklist — `feature/general-manager-interface`

> ## ★★★ LOGGING DISCIPLINE — VITALLY IMPORTANT (Trevor 2026-08-19) ★★★
> **EVERY schema or SQL change is logged HERE, no exceptions.** This file is the single
> authoritative record for the staging→prod push. The instant we run ANY of the following
> on staging, an entry is appended here BEFORE moving on:
> - a `CREATE TABLE` / `ALTER TABLE` (columns, types, constraints, indexes)
> - a `DROP` (table/column/view/function/RPC) — even a temp/helper cleanup
> - a data write that must be reproduced on prod (backfill, recompute, UPDATE)
> - an RLS `ENABLE` / policy, a role/GUC change, a new RPC or view
>
> Each entry states: the exact DDL/SQL, `APPLIED STAGING <date>` vs `PROD pending`, and any
> **prod-specific note** (e.g. "regenerate the fixture from PROD data, do NOT copy staging"
> when a value is per-env). A change that touches the DB but is NOT written here is a bug.
> The prod push reads ONLY this file — if it's not here, it doesn't happen on prod. [[feedback_claude_runs_backfills_dry_run]]

Every schema change on this branch that is **not yet on prod**, in apply order. Run
these against prod at push time (staging already has them). Most use
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-running is safe —
but **verify each against prod first and skip any already applied out of band.**

Apply in filename (timestamp) order. Runner used on staging:
`npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts <file>`
(⚠️ prod = `.env.production.local` → `trbvxuoliwrfowibatkm`. Requires explicit go.)

## Migrations (chronological = apply order)

- [ ] `20260705120000_gm_front_office_finance.sql`
- [ ] `20260706120000_gm_scholarship.sql`
- [ ] `20260707120000_gm_scholarship_total.sql`
- [ ] `20260707130000_gm_other_breakdown.sql`
- [ ] `20260707140000_gm_finance_per_build.sql`  — gm_player_finance re-keyed to build_player_id (+ roster_status/departure_reason)
- [ ] `20260707150000_gm_recruits.sql`
- [ ] `20260707160000_gm_recruits_stage.sql`
- [ ] `20260707170000_gm_recruit_events.sql`
- [ ] `20260707180000_gm_recruits_report_date.sql`
- [ ] `20260707190000_gm_recruit_reports.sql`
- [ ] `20260707200000_gm_recruits_tier.sql`
- [ ] `20260707210000_gm_recruit_contact.sql`
- [ ] `20260707220000_gm_recruit_report_tier.sql`
- [ ] `20260707230000_team_builds_gm_notes.sql`
- [ ] `20260708120000_gm_player_finance_notes.sql`
- [ ] `20260708130000_gm_player_finance_notes_date.sql`
- [ ] `20260708140000_gm_player_notes.sql`
- [ ] `20260708150000_gm_recruits_pricing.sql`
- [ ] `20260708160000_gm_activity.sql`
- [ ] `20260708170000_gm_recruits_level.sql`
- [ ] `20260708180000_gm_recruits_extra_contacts.sql`
- [ ] `20260709120000_gm_activity_link.sql`
- [ ] `20260709130000_gm_recruiting_budget.sql`
- [ ] `20260709140000_gm_activity_ref.sql`
- [ ] `20260709150000_gm_target_board.sql`
- [ ] `20260709160000_gm_target_asking.sql`
- [ ] `20260709170000_gm_allocations.sql`  — gm_allocation_source + gm_allocation (funding sources)
- [ ] `20260710120000_gm_allocations_per_build.sql`
- [ ] `20260710130000_gm_scholarship_mode.sql`
- [ ] `20260713120000_gm_contracts.sql`  — gm_contract + gm_contract_obligation + gm-contracts storage bucket
- [ ] `20260713140000_team_builds_is_active.sql`  — the live/active build flag
- [ ] `20260714120000_gm_player_info.sql`
- [ ] `20260714150000_gm_player_info_social.sql`
- [ ] `20260714170000_marketability.sql`
- [ ] `20260714190000_marketability_youtube.sql`

### Vendor unification (project_gm_vendor_unification)
- [ ] `20260716120000_gm_vendor.sql`  — slice 1: program-level vendor directory (staging 2026-07-16)
- [ ] `20260716130000_gm_contract_vendor_link.sql`  — slice 3a: gm_contract.vendor_id + gm_allocation_source.vendor_id + backfill directory + link (staging 2026-07-16)
- [ ] `20260716150000_gm_source_funding_mode.sql`  — slice 4a: gm_allocation_source.funding_mode + base_offset (new-money vs carve accounting) (staging 2026-07-16)
- [ ] `20260716170000_gm_contract_funding.sql`  — slice 4b: gm_contract.funding_mode + base_offset + allocation_id (staging 2026-07-16)

## Non-migration prod steps (from memory)
- ~~Deploy the `parse-contract` edge function + `ANTHROPIC_API_KEY`~~ — NOT needed: contract PDFs are read entirely in the browser (`extractContractPdf`, pdfjs, no AI/network). The AI `parse` path in useGmContracts is dead code (nothing calls it) — remove it.
- [ ] Headshot scrape: run the roster scraper against prod customer teams after push (returners + incoming transfers).
- [ ] **Contract funding backfill** (AFTER the 4 vendor migrations): `npx tsx --env-file-if-exists=.env.production.local scripts/backfill_contract_funding.ts --write` — syncs existing NIL/Other contracts into funding sources/allocations (idempotent; dry-run first without `--write`).

- [ ] 20260717120000_user_team_access_team_admin_modify.sql — RLS: team_admins can modify their own team user_team_access (fixes admin remove-access)

### Recruit identity + mobile recruiting + scouting v2 (`feature/recruit-ids-mobile-board`)
Apply in order at push time. All additive/idempotent. Staging dates noted.
> **✅ APPLIED TO PROD 2026-07-30** — all 4 migrations + backfill run against prod (`trbvxuoliwrfowibatkm`) via `supabase db query --linked`, catalog-verified. BYU had 4 recruits → 4 `prospect` identities minted (Nixon Warren LF→OF normalized first). CODE still pending staging→main (PR #159).
- [x] `20260728120000_player_external_ids_and_prospect.sql` — vendor-agnostic identity crosswalk (`player_external_ids`) + `data_status='prospect'` (staging 2026-07-28, catalog-verified)
- [x] `20260728121000_resolve_or_create_prospect.sql` — `resolve_or_create_prospect()` SECURITY DEFINER writer; exact-external-key auto-link only (staging 2026-07-28, round-trip verified)
- [x] `20260729120000_scout_grades_and_template.sql` — `gm_recruit_reports.grades` JSONB + `gm_scout_template` (per-team customizable scouting template) (staging 2026-07-29)
- [x] `20260730120000_gm_recruits_player_identity.sql` — adds `gm_recruits.player_id` FK → `players(id)` (the recruit↔RSTR IQ identity link; minted at add via `resolve_or_create_prospect`) (staging 2026-07-30, verified)

**Non-migration prod steps for this feature (append as they arise):**
- [ ] Scouting v2 storage: create the `recruit-video` bucket + retention/lifecycle via the Supabase dashboard (owner-restricted — can't go through the SQL runner). [pending 1d]
- [x] Recruit identity backfill (AFTER `20260730120000`): run `supabase/queries/backfill_gm_recruits_player_id.sql` — mints/attaches an identity for every pre-existing recruit (idempotent; only touches `player_id IS NULL`). Staging 2026-07-30: 9/9 linked, 0 orphaned.

- [ ] 20260808_pitch_log_add_sequence.sql — add pitch_num_in_game/ab_num_in_game/pitch_num_in_ab + backfill (scripts/sql/pitch_log_sequence_backfill_steps.sql). APPLIED STAGING 2026-08-08 (2,576,230 rows). PROD pending.

- [ ] team_drs_store.sql (scripts/sql/) — add team_drs column to team_war_snapshots + populate 308 D1 teams (re-centered dRS, season 2026). APPLIED STAGING 2026-08-09 (308 rows, sum ~0). PROD pending. Regenerate values via scripts/drs/derive_team_drs.mjs against prod.

## WAR redesign + internals collapse (feature/war-recalibration) — full run order in docs/STEP8_PROD_MIGRATION_LEDGER.md
- [ ] A1 descriptive_war_columns.sql — Master desc_* columns. PROD pending.
- [ ] A2 descriptive_war_reg_columns.sql — Master desc_*_reg columns. PROD pending.
- [ ] B1 step8_model_config_2026.sql — COMPLETE @2026 model_config mirror (wRC+ C1 + composite refits + replacement 21.22). PROD pending.
- [ ] B2 UPDATE ncaa_averages SET wrc=0.3782 WHERE season=2026. PROD pending.
- [ ] C1/C2 backfill Hitter Master pull_air + Pitching Master in_zone_pct from prod pitch_log. PROD pending.
- [ ] D1 store recompute (power ratings) on prod. PROD pending.
- [ ] E1/E2 populate_descriptive_war(.mjs) + _reg on 0.3782. PROD pending.
- [ ] F1 20260810_composite_war_d1_rescale.sql (refresh_composite_war ÷13.1 DEFINITION) → F2 fire after precompute. PROD pending.
- [ ] G1/G2 precompute-returner-hitters/pitchers:prod. G3 transfers via edge fn (when resumed). PROD pending.
- [ ] H1 reseed team_war_snapshots; H2 fill player/transfer snapshots; H3 total-WAR display swap. PROD pending.
- [ ] J DROP player_prediction_internals (Track B, AFTER bulkRecalc retired). PROD pending — separate confirmed step.

## Stuff+ classification build (feature/war-recalibration) — 2026-08-17
- [ ] venue_correction_persist.sql (scratchpad/) — `venue_movement_corrections` table (310 rows, season 2026, LOO + empirical-Bayes shrunk IVB/HB offsets) + `pitch_log_corrected` stamped VIEW (`venue_correction_version=v1-2026-loo-eb`). Feeds Stuff+ classification AND scoring (one corrected movement layer). APPLIED STAGING 2026-08-17. **PROD: REGENERATE the fixture from PROD pitch_log (per-season, prod venue ids) — do NOT copy staging offsets.** Named "venue movement effects" (miscalibration OR thin-air), not sensor errors.
- [ ] pitch_log.vaa column (`alter table pitch_log add column if not exists vaa numeric`) — RESERVED SLOT (ruling 2026-08-17: do NOT derive; per-pitch VAA absent from all current exports; cluster-mean carries the SI/FF strip). ingest_pitch_log.ts maps VertApprAngle→vaa (forward-compatible). Populates when future LOCAL-TrackMan source ships real VAA/HAA. No prod action until then.
- [x] venue_movement_corrections RLS — `ALTER TABLE public.venue_movement_corrections ENABLE ROW LEVEL SECURITY;` APPLIED STAGING 2026-08-17 (no policy = service-role only, correct for a pipeline fixture). PROD: same ALTER after the table is created on prod.

## Park-factor rebuild + hygiene (feature/war-recalibration) — 2026-08-18
- [x] Stuff+ temp-table RLS lockdown — `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` for the 6 Stuff+ backup/helper
  tables (`_confstats_backup, _master_stuff_backup, _ncaa_backup_preanchor, _reclass_map, _reclass_pf, _reclass_result`).
  APPLIED STAGING 2026-08-18 (was: all exposed to anon/auth; now service-role-only, correct for pipeline temp tables).
  These are STAGING-ONLY Stuff+ artifacts (not promoted to prod). **PROD equivalent:** when Stuff+ regenerates on prod and
  creates its own backup/helper tables, ENABLE RLS on them the same way (or drop after acceptance). The DROP of all 6 staging
  temp tables is DEFERRED to the dead-code audit (#7) AFTER Stuff+ prod acceptance — they are the Stuff+ rollback until then.
- [ ] DROP dead `park_factors` (lowercase, 12 cols, 0 rows) — a duplicate of the live `"Park Factors"` (quoted, 18 cols,
  where 2025/2026 rows actually live + all projection readers point). COUPLED: strip the 2 `from("park_factors")` calls in
  `supabase/functions/google-sheets-sync/index.ts` (lines ~1006/1054) FIRST/together — that function is otherwise LIVE (syncs
  8 tables: players, nil_valuations, player_predictions, season_stats, conference_stats, model_config, power_ratings) so do
  NOT delete the function, only its park_factors delete+insert. Then `DROP TABLE public.park_factors;`. Fold into audit (#7). STAGING+PROD.
- [~] ~~`park_factors_seasonal` (NEW separate table)~~ **SUPERSEDED 2026-08-19 — DO NOT RUN.** Trevor chose COLUMNS on
  `"Park Factors"` (the `*_seasonal` entry directly below), not a separate table. No `park_factors_seasonal` table exists on
  staging; do not create one on prod. Kept here struck-through so the audit trail is explicit.
- [x] `"Park Factors"` seasonal columns + backfill — `ALTER TABLE "Park Factors" ADD COLUMN *_seasonal` (10 cols) +
  `scripts/backfill_park_factors_seasonal.ts --apply` (self-normalized single-season 2024/25/26 + stored 2026 3-yr rolling).
  APPLIED STAGING 2026-08-18 (922 rows). Backup `_park_factors_backup_20260818`. **PROD:** same ALTER + re-run backfill against
  prod (the archived CSVs are league-wide, not per-env — same input both DBs); verify vs prod's current Park Factors rows.- [ ] 20260818000000_pitch_log_park_code.sql — add game_string + park_code to pitch_log (+ index). park_code = stable
  stadium id from gameString (strip trailing 9 digits + `cs-`). APPLIED STAGING 2026-08-18. PROD pending.
  FOLLOW-ON (staging+prod): backfill park_code on existing pitch_log rows from source files (by uniq_pitch_id/game); then
  rebuild pitch-log park factors keyed by park_code + team_id (NOT batting_team_id, which is corrupt). Validated vs TruMedia.- [ ] DROP corrupted pitch_log.batting_team_id + pitching_team_id (source maps 1 id -> up to 15 teams; clean ids =
  team_id/opponent_id, already present). COUPLED (do together, in the dead-code audit): (1) remove batting_team_id/
  pitching_team_id from `scripts/ingest_pitch_log.ts` record + interface; (2) recreate the `pitch_log_corrected` VIEW
  WITHOUT those two columns (it currently SELECTs them) + re-verify Stuff+ classification/scoring still read it;
  (3) `ALTER TABLE pitch_log DROP COLUMN batting_team_id; ALTER TABLE pitch_log DROP COLUMN pitching_team_id;`.
  DRS/WAR/ReturningPlayers do NOT use them (comments / name-alias only). STAGING + PROD.- [ ] Conference Stats HTP+run-env: `ALTER TABLE "Conference Stats" ADD COLUMN run_env_factor double precision, ADD COLUMN
  hitter_talent_plus double precision;` + conf-stats pitch-log build populates them (run_env_factor = conf-avg per-team
  rg_factor from rolling Park Factors; HTP = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor)). Repoint 4 live HTP sites +
  transfer engine to read stored. STAGING first, then PROD. (#3+#4 coordinated.)  [APPLIED STAGING 2026-08-18: ALTER + run_env_factor populate (conf-avg per-team rg_factor via Teams Table) + hitter_talent_plus
  = Overall_Power_Rating + 1.25(Stuff_plus-100) + 0.75(100-run_env_factor), 30 D1 confs. Backup _confstats_backup_20260818.
  PROD: same ALTER + repopulate from prod Park Factors/Teams Table. Then repoint 6 live HTP sites to read stored.]- [ ] LIVE-COMPUTE ELIMINATION (ships with edge fn): edge fn produces stored snapshots (transfer/player) + stored conf
  HTP/run_env/OPR; repoint ALL client live-computes to read stored — HTP (~15 sites), oWAR/wRC+/pWAR (~19, incl TB regression),
  transfer projections (~14), resolveConferenceStats. Per repoint: Supabase types regen + PAGE-LOAD verify (CLAUDE.md gate).
  Files: TransferPortal, TeamBuilder, useTeamBuilderSimulation, PlayerProfile, ReturningPlayers, PitchingConferenceStatsTable,
  savant PitcherPage/ConferenceStatsPage. Goal: ZERO client compute. See handoff §LIVE-COMPUTE AUDIT.- [ ] 20260818010000_pitch_log_is_conference_game.sql — add is_conference_game boolean + index. Backfill:
  is_conference_game = (conference_of(team_id) == conference_of(opponent_id)) via "Teams Table".source_id→conference_id
  (Season 2026). APPLYING STAGING 2026-08-18 (ctid-batched, ~40 batches; index dropped during backfill for HOT, recreated after).
  PROD: same ALTER + backfill (or compute in edge fn on ingest). FORWARD: compute post-ingest (edge-fn stage) since it needs
  the Teams Table conference lookup, not row-by-row. ⚠ team_id/opponent_id are the CLEAN ids (batting_team_id/pitching_team_id corrupt).
## ★ is_conference_game BACKFILL — DONE (staging, 2026-08-18)
2.58M rows flagged: **1,407,734 intra-conf / 1,171,921 non-conf / 0 null** (unmapped opponents → false). Method that worked
after several failures (see BIG-WRITE MECHANICS v2 + the CLI-caps-statements finding): a join-based RPC `flag_conf_batch(n)`
(flags the next n NULL rows in one fast statement via `coalesce(bt.conference_id=ot.conference_id, false)` joining `_team_conf`
on team_id/opponent_id), LOOPED until 0 (`/tmp/conf_flag_loop.sh`). Self-converging + timeout-immune (each call <120s).
CLEANUP (audit): drop one-off RPCs `flag_conf_batch`, `set_conf_game` + helper `_team_conf` after the conf-stats run is built.
PROD: same — migration adds the column; backfill via the RPC-loop (or compute in the edge-fn conf-stats stage on ingest).- [ ] Conference Stats UNIFIED RECOMPUTE (edge-fn stage) — recompute ALL conf fields from pitch-log per the CALCULATION SPEC
  (handoff/agent §CONFERENCE-STATS CALCULATION SPEC): intra-conf hitting+pitching rates (proper denominator; IP=outs/3), env+
  (÷NCAA), wRC+ (C1 OBP/SLG — current; corrects the STALE pre-C1 stored value), FIP (+cFIP≈3.157), ERA (DRS earned runs on
  intra-conf), OPR/Stuff+/scouting/run_env/HTP (total-season rollups). Store in "Conference Stats". THEN retire the 5 producers
  (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages, conferenceStuffPlus-V1) + one-off RPCs
  (flag_conf_batch, set_conf_game) + helper _team_conf. Validated on staging (all rate fields corr 0.98+). STAGING+PROD.- [ ] Conference Stats Bucket-A recompute — APPLIED STAGING 2026-08-18 via scripts/sql/conf_stats_unified_assembly.sql (CTAS
  _conf_agg → UPDATE 29 D1 confs: rates/env+/WRC_plus(C1)/K9/BB9/HR9/WHIP/FIP/ERA). Backup _confstats_backup_preassembly. Fixes
  stale pre-C1 WRC_plus. PROD: same (compute from prod pitch_log; NCAA constants from prod ncaa_averages; cFIP re-derive).
  Then fold into edge fn + retire the 5 producers (build-check-then-clear).

## ★ team_season_stats — NEW canonical per-team-per-season table (feature/war-recalibration) — 2026-08-19
DESIGN + WHY in docs/HANDOFF_STUFF_PLUS_2026_08_16.md + docs/AGENT_LEARNINGS_stuff_plus_2026_08_16.md §TEAM_SEASON_STATS.
Forced by Independents (Oregon State transfers) needing faced-competition; becomes the team-stats layer the system lacks.
Consolidate (Masters philosophy): ONE canonical table; retire team_war_snapshots + Park Factors INTO it AFTER verify (never two live copies).
- [ ] CREATE TABLE `team_season_stats` — key `(source_id, season)` (source_id = STABLE program id; confirmed OSU 3111 / UGA 226
  every season) + store per-season `id` (uuid) + `conference_id`. COLUMNS (fill ALL first pass, computed in the ONE edge fn):
  faced_stuff_plus, faced_htp, conf_stuff_plus, conf_htp, run_env_factor, ERA/AVG/OBP/SLG/ISO/wRC+/K9/BB9/HR9/WHIP/FIP,
  desc_war, total_war, park factors USED (3-yr rolling that feeds projections + single-season, a derived snapshot from `"Park Factors"`),
  (future: home/road splits, per-player faced). RLS ENABLE (service-role pipeline table).
  STAGING first (build + fill + A/B), then PROD (same DDL + edge-fn populate from prod pitch_log/Teams Table/Park Factors).
- [ ] CONSOLIDATION (build-check-then-clear, LAST) — **subsume `team_war_snapshots`, FEDERATE `Park Factors` (Trevor 2026-08-19):**
  - `team_war_snapshots` is the SAME grain (team×season) → after team_season_stats WAR cols A/B-match it, repoint readers
    (useTeamWarSnapshot/useWarBenchmarks/CLAUDE.md TB Compare) → then `DROP TABLE team_war_snapshots`. ⚠ NOT until cols verify on staging+prod.
  - `"Park Factors"` is a DIFFERENT grain (park-data INPUT store: raw single-season + rolling, ALL history) → **KEEP IT, do NOT retire.**
    It's always needed as the historical park source + projection ingredient (we are NOT backfilling full park history into team rows).
    team_season_stats stores a DERIVED SNAPSHOT of the values USED for that team-season: the 3-yr rolling (projection input) + the
    single-season, both stamped by the edge fn from `"Park Factors"` each run. Single writer = no drift; `"Park Factors"` stays source-of-truth.
  - Every step (CREATE, each ADD COLUMN, the team_war_snapshots DROP, the repoint) gets its own line logged when applied — per the banner at top.