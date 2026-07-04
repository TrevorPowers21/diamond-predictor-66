-- ============================================================================
-- FULL DATA ROLLBACK — reverts EVERY data change from the deploy (default-build
-- seed + target consolidation) back to the pre-deploy snapshot.
--
-- Pair with `git revert` of the staging->main merge for the CODE. The additive
-- columns (is_default / academic_year) can stay — they are inert to old code.
--
-- CAVEAT: this restores the EXACT pre-deploy snapshot. Any coach change made
-- AFTER the backup (during the deploy window) is also reverted. That's why we
-- deploy off-hours and roll back quickly. Transaction-wrapped: all-or-nothing.
--
-- Apply via:  npm run db-migrate -- supabase/rollback/20260704_restore_from_backup.sql
-- (confirm --linked = PROD first)
-- ============================================================================
BEGIN;

-- 1. team_build_players: restore exactly.
--    Re-adds the 130 watchlist rows the migration deleted, and drops the
--    seeded default-build players (they weren't in the snapshot).
DELETE FROM team_build_players;
INSERT INTO team_build_players SELECT * FROM team_build_players_bak_20260704;

-- 2. team_builds: remove seeded default builds (anything not in the snapshot).
--    Originals are untouched — the seed only inserts, never modifies.
DELETE FROM team_builds WHERE id NOT IN (SELECT id FROM team_builds_bak_20260704);

-- 3. target_board: restore exactly (drops the migration's inserts).
DELETE FROM target_board;
INSERT INTO target_board SELECT * FROM target_board_bak_20260704;

COMMIT;

-- verify parity with the snapshot
SELECT 'team_build_players match' AS check,
  (SELECT count(*) FROM team_build_players) AS now,
  (SELECT count(*) FROM team_build_players_bak_20260704) AS snapshot
UNION ALL SELECT 'target_board match',
  (SELECT count(*) FROM target_board), (SELECT count(*) FROM target_board_bak_20260704);
