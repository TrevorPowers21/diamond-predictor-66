-- Add national_seed_rank to team_war_snapshots.
--
-- Replaces the National Champion benchmark with a National Seed (1-8) +
-- Regional Host (9-16) benchmark in Program Analytics. Postseason results
-- aren't a roster-build benchmark (too dependent on bracket variance);
-- regular-season top-16 placement is the better signal for "what it takes
-- to host a Super Regional."
--
-- Rank semantics:
--   1-8   → National seed (host through Super Regional)
--   9-16  → Regional host (host through Regional only)
--   NULL  → Unseeded

ALTER TABLE team_war_snapshots
  ADD COLUMN IF NOT EXISTS national_seed_rank int;

COMMENT ON COLUMN team_war_snapshots.national_seed_rank IS
  'NCAA tournament seed rank for the season. 1-8 = National seed (host through Super Regional), 9-16 = Regional host, NULL = unseeded. Drives the Program Analytics range comparison.';

CREATE INDEX IF NOT EXISTS idx_team_war_snapshots_national_seed
  ON team_war_snapshots (season, national_seed_rank)
  WHERE national_seed_rank IS NOT NULL;
