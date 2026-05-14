-- Regular-season-only PA/IP snapshot columns. Populated by the
-- `lock_regular_season(season)` function below at end of each regular season.
-- Once locked, tier classification (TeamBuilder hitter + pitcher depth roles)
-- reads regular_season_pa / regular_season_ip in preference to live pa / IP,
-- so postseason ABs/innings don't inflate playoff-team players' tiers.

ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS regular_season_pa INTEGER NULL;

ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS regular_season_ip NUMERIC NULL;

-- Idempotent locker. Returns counts of rows actually written (NULL → set).
-- Safe to re-run; the IS NULL guard prevents overwriting an existing snapshot,
-- which is what makes the lock "set in stone" for the rest of the season.
CREATE OR REPLACE FUNCTION lock_regular_season(p_season INTEGER)
RETURNS TABLE (hitters_locked INTEGER, pitchers_locked INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  h_count INTEGER;
  p_count INTEGER;
BEGIN
  UPDATE "Hitter Master"
     SET regular_season_pa = pa
   WHERE "Season" = p_season
     AND regular_season_pa IS NULL;
  GET DIAGNOSTICS h_count = ROW_COUNT;

  UPDATE "Pitching Master"
     SET regular_season_ip = "IP"
   WHERE "Season" = p_season
     AND regular_season_ip IS NULL;
  GET DIAGNOSTICS p_count = ROW_COUNT;

  RETURN QUERY SELECT h_count, p_count;
END;
$$;

GRANT EXECUTE ON FUNCTION lock_regular_season(INTEGER) TO service_role, authenticated, anon;
