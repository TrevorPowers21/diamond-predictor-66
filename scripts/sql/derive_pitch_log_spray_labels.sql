-- One-time backfill: populate hit_location + batted_direction on existing
-- batted-ball rows in pitch_log. Paste into the SQL editor WITHOUT a
-- BEGIN/COMMIT wrap so it survives the ~60s API gateway timeout (the DB
-- keeps running after disconnect). Idempotent via `hit_location IS NULL`.
--
-- Going forward, scripts/derive_pitch_log_flags.ts sets these on ingest, so
-- this is only needed once on already-flagged data (staging now, prod later).
--
-- Cutoffs (locked w/ Trevor):
--   hit_location:  far_left -45..-30 | left_center -30..-15 | center -15..15
--                  | right_center 15..30 | far_right 30..45
--   direction:     center band +/-15 (matches Master HPull%); RHB pulls left,
--                  LHB pulls right; resolved per row so switch hitters are exact.

UPDATE public.pitch_log
SET
  hit_location = CASE
    WHEN spray_ang < -30 THEN 'far_left'
    WHEN spray_ang < -15 THEN 'left_center'
    WHEN spray_ang <= 15 THEN 'center'
    WHEN spray_ang <= 30 THEN 'right_center'
    ELSE 'far_right'
  END,
  batted_direction = CASE
    WHEN spray_ang >= -15 AND spray_ang <= 15 THEN 'center'
    WHEN batter_hand = 'R' THEN (CASE WHEN spray_ang < -15 THEN 'pull' ELSE 'oppo' END)
    WHEN batter_hand = 'L' THEN (CASE WHEN spray_ang > 15 THEN 'pull' ELSE 'oppo' END)
    ELSE NULL
  END
WHERE is_batted_ball_in_play
  AND spray_ang IS NOT NULL
  AND spray_ang BETWEEN -45 AND 45
  AND hit_location IS NULL;
