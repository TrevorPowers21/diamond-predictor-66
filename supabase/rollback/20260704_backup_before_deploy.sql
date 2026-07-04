-- ============================================================================
-- PRE-DEPLOY SNAPSHOT — run RIGHT BEFORE Step 2 (the migration).
-- Copies the three tables the deploy touches into in-DB backup tables.
-- Read-only against live data (CREATE TABLE AS SELECT copies rows into NEW
-- tables; nothing existing is modified). Fast — these tables are small.
-- Apply via:  npm run db-migrate -- supabase/rollback/20260704_backup_before_deploy.sql
-- (confirm --linked = PROD first)
-- ============================================================================
DROP TABLE IF EXISTS team_builds_bak_20260704;
DROP TABLE IF EXISTS team_build_players_bak_20260704;
DROP TABLE IF EXISTS target_board_bak_20260704;

CREATE TABLE team_builds_bak_20260704        AS SELECT * FROM team_builds;
CREATE TABLE team_build_players_bak_20260704 AS SELECT * FROM team_build_players;
CREATE TABLE target_board_bak_20260704       AS SELECT * FROM target_board;

-- sanity: row counts captured
SELECT 'team_builds'        AS tbl, count(*) FROM team_builds_bak_20260704
UNION ALL SELECT 'team_build_players', count(*) FROM team_build_players_bak_20260704
UNION ALL SELECT 'target_board',       count(*) FROM target_board_bak_20260704;
