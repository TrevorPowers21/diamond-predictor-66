# RLS Living Analysis

database: STAGING · 100 tables · 127 policies
⚠ Read-only schema introspection. Proves what policies EXIST, not that they are correct.

## RLS DISABLED (6)

  Any authenticated client can read/write these in full. Intentional for lookup tables;
  a hole for anything program-scoped.

  _ggate_before                                ~42 rows
  _hm_prestep5_backup                          ~30,027 rows
  _pm_prestep5_backup                          ~29,239 rows
  _reclass_fix                                 ~2,015,321 rows
  _seed_agg                                    ~30,839 rows
  _v2_prechain_backup                          ~2,579,655 rows

## RLS ON WITH NO POLICY — deny-all (17)

  RLS enabled and zero policies means NOBODY can read or write via the anon/authenticated
  role. Service-role bypasses it, so a script works and the app silently sees nothing.

  _confstats_backup                            ~42 rows
  _confstats_backup_20260818                   ~162 rows
  _confstats_backup_preassembly                ~162 rows
  _master_stuff_backup                         ~8,072 rows
  _ncaa_backup_preanchor                       ~18 rows
  _park_code_fix                               ~2,576,230 rows
  _park_factors_backup_20260818                ~615 rows
  _park_home_2026                              ~308 rows
  _pitcher_name_fix                            ~15,561 rows
  _reclass_map                                 ~37,256 rows
  _reclass_pf                                  ~5,364 rows
  _reclass_result                              ~2,000,674 rows
  _team_conf                                   ~466 rows
  player_season_baserunning                    ~10,408 rows
  player_season_defense                        ~13,454 rows
  team_season_stats                            ~308 rows
  venue_movement_corrections                   ~310 rows

## WRITE-PATH COVERAGE — readable but not writable

  The failure this catches: an RLS-blocked write returns SUCCESS with 0 rows affected and no
  error. Remove-access silently deleted 0 rows exactly this way.

  Conference Names                             policies for: SELECT
  Equation Weights_LEGACY_2025                 policies for: SELECT
  Park Factors                                 policies for: SELECT
  Teams Table                                  policies for: SELECT
  abs_hitter_stats                             policies for: SELECT
  abs_pitcher_stats                            policies for: SELECT
  ai_scouting_reports                          policies for: SELECT
  hitter_bat_speed_season                      policies for: SELECT
  pitch_log                                    policies for: SELECT
  pitch_log_hitter_by_pitch_type               policies for: SELECT
  pitch_log_hitter_by_zone                     policies for: SELECT
  pitch_log_hitter_totals                      policies for: SELECT
  pitch_log_pitcher_by_pitch_type              policies for: SELECT
  pitch_log_pitcher_by_zone                    policies for: SELECT
  pitch_log_pitcher_totals                     policies for: SELECT
  pitch_log_xba_lookup                         policies for: SELECT
  player_billing_customers                     policies for: SELECT
  player_billing_events                        policies for: SELECT
  player_entitlements                          policies for: SELECT
  player_external_ids                          policies for: SELECT
  player_slot_values                           policies for: SELECT
  team_war_snapshots                           policies for: SELECT

## SELF-REFERENCING POLICIES — recursion risk

  A policy on table X whose USING clause selects from X recurses unless it goes through a
  SECURITY DEFINER function.

  user_roles  Bootstrap first admin role
      

## PROGRAM SCOPING — customer_team_id

  Program-scoped data must key off customer_team_id. A table that HAS the column but whose
  policies never mention it is scoped by convention only.

  coach_notes                                  ✅ scoped
  customer_team_equation_overrides             ✅ scoped
  gm_activity                                  ✅ scoped
  gm_allocation                                ✅ scoped
  gm_allocation_source                         ✅ scoped
  gm_budget                                    ✅ scoped
  gm_class_config                              ✅ scoped
  gm_contract                                  ✅ scoped
  gm_contract_obligation                       ✅ scoped
  gm_player_finance                            ✅ scoped
  gm_player_info                               ✅ scoped
  gm_player_notes                              ✅ scoped
  gm_program_marketability                     ✅ scoped
  gm_recruit_events                            ✅ scoped
  gm_recruit_reports                           ✅ scoped
  gm_recruits                                  ✅ scoped
  gm_scout_template                            ✅ scoped
  gm_target_notes                              ✅ scoped
  gm_target_offer                              ✅ scoped
  gm_vendor                                    ✅ scoped
  high_follow                                  ⚠ policies ignore it
  player_predictions                           ⚠ policies ignore it
  precompute_jobs                              ⚠ policies ignore it
  target_board                                 ✅ scoped
  team_builds                                  ✅ scoped
  team_market_pay_log                          ✅ scoped
  user_team_access                             ✅ scoped

## PER-TABLE POLICY MATRIX

  cmd → the roles the policy applies to. `{public}` means every role.

  Conference Names
      SELECT        {public}         Allow public read
  Conference Stats
      SELECT        {public}         Allow public read
      ALL           {public}         conference_stats_allow_all
      ALL           {public}         conference_stats_allow_all_writes
  Equation Weights_LEGACY_2025
      SELECT        {public}         Allow public read
  Hitter Master
      INSERT        {public}         Allow public insert
      SELECT        {public}         Allow public read
      UPDATE        {public}         Allow public update
  Park Factors
      SELECT        {public}         Allow public read
  Pitch Arsenal
      SELECT        {public}         Allow public read
      ALL           {public}         Allow public write
  Pitching Master
      SELECT        {public}         Allow public read
      ALL           {public}         Allow public write
  Teams Table
      SELECT        {public}         Allow public read
  abs_hitter_stats
      SELECT        {authenticated}  abs_hitter_stats_read_authenticated
  abs_pitcher_stats
      SELECT        {authenticated}  abs_pitcher_stats_read_authenticated
  ai_scouting_reports
      SELECT        {authenticated}  ai_scouting_reports_read_authenticated
  coach_notes
      DELETE        {public}         Users delete own notes
      INSERT        {public}         Users insert own notes
      UPDATE        {public}         Users update own notes
      SELECT        {public}         Users view own notes
      ALL           {authenticated}  coach_notes_modify
      SELECT        {authenticated}  coach_notes_select
  conference_adjusted_stats
      SELECT        {authenticated}  Authenticated users can read conference_adjusted_stats
      ALL           {authenticated}  Staff can manage conference_adjusted_stats
  customer_team_equation_overrides
      ALL           {public}         Superadmin manages equation overrides
      SELECT        {public}         Team members read equation overrides
  customer_teams
      ALL           {authenticated}  customer_teams_modify
      SELECT        {authenticated}  customer_teams_select
  developmental_weights
      SELECT        {authenticated}  Authenticated users can read developmental_weights
      ALL           {authenticated}  Staff can manage developmental_weights
  gm_activity
      ALL           {authenticated}  gm_activity_all
  gm_allocation
      ALL           {authenticated}  gm_allocation_all
  gm_allocation_source
      ALL           {authenticated}  gm_allocation_source_all
  gm_budget
      ALL           {authenticated}  gm_budget_all
  gm_class_config
      ALL           {authenticated}  gm_class_config_all
  gm_contract
      ALL           {authenticated}  gm_contract_all
  gm_contract_obligation
      ALL           {authenticated}  gm_contract_obligation_all
  gm_player_finance
      ALL           {authenticated}  gm_player_finance_all
  gm_player_info
      ALL           {authenticated}  gm_player_info_all
  gm_player_notes
      ALL           {authenticated}  gm_player_notes_all
  gm_program_marketability
      ALL           {authenticated}  gm_program_marketability_all
  gm_recruit_events
      ALL           {authenticated}  gm_recruit_events_all
  gm_recruit_reports
      ALL           {authenticated}  gm_recruit_reports_all
  gm_recruits
      ALL           {authenticated}  gm_recruits_all
  gm_scout_template
      ALL           {authenticated}  gm_scout_template_all
  gm_target_notes
      ALL           {authenticated}  gm_target_notes_all
  gm_target_offer
      ALL           {authenticated}  gm_target_offer_all
  gm_vendor
      ALL           {authenticated}  gm_vendor_all
  high_follow
      ALL           {public}         Users can manage their own high follow list
  hitter_bat_speed_season
      SELECT        {authenticated}  hitter_bat_speed_season_read
  model_config
      SELECT        {public}         Authenticated users can read model_config
      ALL           {public}         Staff can manage model_config
  ncaa_averages
      ALL           {public}         admin can write ncaa averages
      SELECT        {public}         anyone can read ncaa averages
  nil_valuations
      SELECT        {authenticated}  Authenticated users can read nil_valuations
      ALL           {authenticated}  Staff can manage nil_valuations
  park_factors
      SELECT        {authenticated}  Authenticated users can read park_factors
      ALL           {authenticated}  Staff can manage park_factors
  pitch_arsenal
      SELECT        {authenticated}  Authenticated users can read pitch_arsenal
      ALL           {authenticated}  Staff can manage pitch_arsenal
  pitch_log
      SELECT        {authenticated}  Authenticated users can read pitch_log
  pitch_log_hitter_by_pitch_type
      SELECT        {authenticated}  Authenticated users can read pitch_log_hitter_by_pitch_type
  pitch_log_hitter_by_zone
      SELECT        {authenticated}  Authenticated users can read pitch_log_hitter_by_zone
  pitch_log_hitter_totals
      SELECT        {authenticated}  Authenticated users can read pitch_log_hitter_totals
  pitch_log_pitcher_by_pitch_type
      SELECT        {authenticated}  Authenticated users can read pitch_log_pitcher_by_pitch_type
  pitch_log_pitcher_by_zone
      SELECT        {authenticated}  Authenticated users can read pitch_log_pitcher_by_zone
  pitch_log_pitcher_totals
      SELECT        {authenticated}  Authenticated users can read pitch_log_pitcher_totals
  pitch_log_xba_lookup
      SELECT        {authenticated}  Authenticated users can read pitch_log_xba_lookup
  pitcher_role_overrides
      ALL           {public}         Allow all access for now
  pitcher_stuff_plus_inputs
      INSERT        {authenticated}  Allow authenticated insert
      SELECT        {authenticated}  Allow authenticated select
      UPDATE        {authenticated}  Allow authenticated update
  pitcher_stuff_plus_ncaa
      INSERT        {authenticated}  Allow authenticated insert
      SELECT        {authenticated}  Allow authenticated select
      UPDATE        {authenticated}  Allow authenticated update
  platform_config
      SELECT        {public}         authenticated read platform_config
      ALL           {public}         superadmin write platform_config
  player_accounts
      INSERT        {authenticated}  player_accounts_insert
      SELECT        {authenticated}  player_accounts_select
      UPDATE        {authenticated}  player_accounts_update
  player_billing_customers
      SELECT        {authenticated}  player_billing_customers_select
  player_billing_events
      SELECT        {authenticated}  player_billing_events_select_superadmin
  player_entitlements
      SELECT        {authenticated}  player_entitlements_select
  player_external_ids
      SELECT        {authenticated}  player_external_ids_read
  player_overrides
      ALL           {public}         Allow all access for now
  player_prediction_internals
      ALL           {public}         Admin/staff can manage internal ratings
      SELECT        {public}         Admins can read internal ratings
  player_predictions
      SELECT        {public}         Authenticated users can read player_predictions
      ALL           {public}         Staff can manage player_predictions
  player_slot_values
      SELECT        {authenticated}  player_slot_values_read_authenticated
  players
      SELECT        {public}         Allow public read
      UPDATE        {public}         Allow public update
      SELECT        {authenticated}  Authenticated users can read players
      ALL           {authenticated}  Staff can manage players
  portal_entries_unmatched
      DELETE        {authenticated}  authenticated_delete_unmatched
      INSERT        {authenticated}  authenticated_insert_unmatched
      SELECT        {authenticated}  authenticated_read_unmatched
      UPDATE        {authenticated}  authenticated_update_unmatched
  power_ratings
      SELECT        {authenticated}  Authenticated users can read power_ratings
      ALL           {authenticated}  Staff can manage power_ratings
  precompute_jobs
      ALL           {public}         Superadmin manages precompute jobs
  profiles
      INSERT        {authenticated}  Users can insert their own profile
      UPDATE        {authenticated}  Users can update their own profile
      SELECT        {authenticated}  Users can view their own profile
  rstr_reclassification_log
      INSERT        {authenticated}  Authenticated users can insert reclassification logs
      SELECT        {authenticated}  Authenticated users can read reclassification logs
  season_stats
      SELECT        {authenticated}  Authenticated users can read season_stats
      ALL           {authenticated}  Staff can manage season_stats
  target_board
      ALL           {authenticated}  target_board_modify
      SELECT        {authenticated}  target_board_select
  team_build_players
      ALL           {authenticated}  team_build_players_modify
      SELECT        {authenticated}  team_build_players_select
  team_builds
      ALL           {authenticated}  team_builds_modify
      SELECT        {authenticated}  team_builds_select
  team_market_pay_log
      DELETE        {authenticated}  market_pay_log_delete
      INSERT        {authenticated}  market_pay_log_insert
      SELECT        {authenticated}  market_pay_log_select
      UPDATE        {authenticated}  market_pay_log_update
  team_war_snapshots
      SELECT        {authenticated}  Authenticated users can read team_war_snapshots
  temp_csv_players
      ALL           {public}         Staff can manage temp_csv_players
  user_roles
      ALL           {authenticated}  Admins can manage roles
      INSERT        {authenticated}  Bootstrap first admin role
      SELECT        {authenticated}  Users can view their own roles
  user_team_access
      ALL           {authenticated}  user_team_access_modify
      SELECT        {authenticated}  user_team_access_select
      ALL           {authenticated}  user_team_access_team_admin_modify

## WHAT THIS DOES NOT PROVE

  Policies EXIST — not that they are correct. It does not execute a query as each actor, so it
  cannot show that a coach is actually prevented from reading another program's rows. That
  needs real sessions per role. Treat a clean run as 'no structural hole', never 'RLS is right'.
