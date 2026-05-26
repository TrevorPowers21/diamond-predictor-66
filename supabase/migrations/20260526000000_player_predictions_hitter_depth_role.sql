-- Add hitter_depth_role to player_predictions.
--
-- Auto-assigned from last-season PA via defaultHitterDepthRoleFromActualPa.
-- Drives projected_pa via paForHitterDepthRole — cornerstone=245, everyday=215,
-- platoon=145, utility=85, bench=25. Removes within-tier jarring gaps in
-- oWAR / market_value that the raw-PA approach created.

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS hitter_depth_role text;

COMMENT ON COLUMN player_predictions.hitter_depth_role IS
  'Auto-assigned hitter depth tier from last-season PA. Values: cornerstone | everyday_starter | platoon_starter | utility | bench. Drives projected_pa.';
