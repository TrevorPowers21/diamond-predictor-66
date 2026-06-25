-- 2026-06-25 — Per-pitch-type RV components
--
-- Adds three columns to pitch_log_pitcher_by_pitch_type so we can
-- compute proper per-pitch-type Run Value (RV/100):
--
--   * balls         — COUNT pitch_result = 'Ball'
--   * fouls         — COUNT pitch_result = 'Foul'
--   * hbps_caused   — COUNT pitch_result_category = 'HBP' (terminal HBP)
--
-- Combined with the existing whiffs, called_strikes, hits, batted_balls_*,
-- this gives every input needed for RV using MLB linear weights:
--   Ball +0.062, Called Strike -0.066, Whiff -0.118, Foul -0.038,
--   HBP +0.732, 1B +0.475, 2B +0.766, 3B +1.034, HR +1.405, BIP out -0.243
--
-- Walks and strikeouts implicitly inherit the per-pitch weight (ball /
-- called-strike / whiff) — the averaged weights already account for the
-- walk-ending ball and K3 cases.
--
-- All adds are additive (ADD COLUMN IF NOT EXISTS, default 0 so existing
-- rows are non-null).

ALTER TABLE public.pitch_log_pitcher_by_pitch_type
  ADD COLUMN IF NOT EXISTS balls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fouls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hbps_caused integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walks_caused integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strikeouts_caused integer NOT NULL DEFAULT 0;
