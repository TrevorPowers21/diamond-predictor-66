# Migration Drift

167 migration files · 326 named objects declared
⚠ Regex, not a parser. A later migration may legitimately drop or rename an object, so MISSING
  is a candidate for review. KIND MISMATCH is the high-signal finding — a later drop cannot
  explain an object existing under the declared name as a different kind of thing.


══ STAGING
  ⛔ KIND MISMATCH (1) — declared as one kind, deployed as another
     team_build_players_unique_player_role
       declared CONSTRAINT in 20260611200000_team_build_players_unique_player_role.sql
       deployed as INDEX  ← the repo does not describe this database

  ⚠ DECLARED BUT ABSENT (41) — review; a later migration may have dropped it
     policy (25): Authenticated users can read player_predictions, Authenticated users can read teams, Staff can manage teams, Authenticated users can view conference stats, Admin/staff can insert conference stats, Admin/staff can update conference stats … +19
     index (7): idx_teams_conference, idx_teams_name, idx_hitter_stats_storage_player_id, idx_hitting_power_ratings_storage_player_id, idx_ai_scouting_reports_player, idx_parks_team_id … +1
     table (7): teams, conference_stats, pitching_power_ratings_storage, hitter_stats_storage, hitting_power_ratings_storage, pitching_stats_storage … +1
     constraint (2): pitching_power_ratings_storage_name_team_season_key, target_board_user_team_player_unique

══ PROD
  ⛔ KIND MISMATCH (1) — declared as one kind, deployed as another
     team_build_players_unique_player_role
       declared CONSTRAINT in 20260611200000_team_build_players_unique_player_role.sql
       deployed as INDEX  ← the repo does not describe this database

  ⚠ DECLARED BUT ABSENT (39) — review; a later migration may have dropped it
     policy (25): Authenticated users can read player_predictions, Authenticated users can read teams, Staff can manage teams, Authenticated users can view conference stats, Admin/staff can insert conference stats, Admin/staff can update conference stats … +19
     index (5): idx_teams_conference, idx_teams_name, idx_hitter_stats_storage_player_id, idx_hitting_power_ratings_storage_player_id, idx_parks_team_id
     table (7): teams, conference_stats, pitching_power_ratings_storage, hitter_stats_storage, hitting_power_ratings_storage, pitching_stats_storage … +1
     constraint (2): pitching_power_ratings_storage_name_team_season_key, target_board_user_team_player_unique

══ WHAT THIS DOES NOT PROVE
  Objects exist by NAME. It does not compare column types, index expressions, or policy
  predicates — two objects can share a name and still differ. It also cannot see objects that
  exist in a database but were never written down at all.
