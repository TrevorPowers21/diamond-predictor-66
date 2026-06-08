-- Add stored pitcher_depth_role on player_predictions for parity with
-- hitter_depth_role.
--
-- Granularity: weekend_starter / weekday_starter / swing_starter (SP variants),
-- workhorse_reliever / high_leverage_reliever / mid_leverage_reliever /
-- low_impact_reliever / specialist_reliever (RP variants).
--
-- Auto-assigned from real IP + pitcher_role by the precompute worker and
-- bulkRecalc. Read sites prefer stored, fall back to live-derive from IP +
-- role for older rows.

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS pitcher_depth_role TEXT;

COMMENT ON COLUMN player_predictions.pitcher_depth_role IS
  'Granular pitcher depth tier (e.g. weekend_starter, high_leverage_reliever). Auto-assigned from players.ip + pitcher_role by the precompute worker. Mirrors hitter_depth_role for the hitter side.';
