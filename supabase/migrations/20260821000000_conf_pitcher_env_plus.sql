-- Conference Stats: per-conference PITCHER env+ columns (ratio scale (conf/ncaa)*100).
-- Was 100% live-computed in 3 drifted resolvers (precompute-pitchers / edge fn / TB hook).
-- Storing them (stored-not-live) collapses the drift and matches the hitter env+ pattern.
-- Populated on the clean 30 D1 confs (NJCAA districts excluded) by
-- scripts/compute_conf_pitcher_env_plus.ts --apply.
ALTER TABLE "Conference Stats"
  ADD COLUMN IF NOT EXISTS era_plus  numeric,
  ADD COLUMN IF NOT EXISTS fip_plus  numeric,
  ADD COLUMN IF NOT EXISTS whip_plus numeric,
  ADD COLUMN IF NOT EXISTS k9_plus   numeric,
  ADD COLUMN IF NOT EXISTS bb9_plus  numeric,
  ADD COLUMN IF NOT EXISTS hr9_plus  numeric;
