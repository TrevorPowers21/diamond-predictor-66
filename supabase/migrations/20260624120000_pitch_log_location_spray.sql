-- 2026-06-24 — Pitch log: SprayAng + Distance + Pitch location columns
--
-- Re-export from TruMedia adds 4 fields per pitch:
--   * SprayAng     — spray angle of batted ball (degrees, neg=pull, pos=oppo)
--   * Distance     — batted ball travel distance (feet)
--   * PzNorm       — normalized vertical pitch location (z-axis)
--   * PxNorm       — normalized horizontal pitch location (x-axis)
--
-- Plus optional TruMedia-supplied xStats (xBA, x1B, x2B, x3B, xHR) which
-- we'll keep as separate columns for cross-check against our (EV, LA)
-- bucket lookup. Adding them here so the ingest script can populate
-- them in one pass.
--
-- All adds are additive (ADD COLUMN IF NOT EXISTS, no defaults — these
-- are optional values per pitch).

ALTER TABLE public.pitch_log
  -- Batted-ball spray (only present when ball is in play)
  ADD COLUMN IF NOT EXISTS spray_ang numeric,
  ADD COLUMN IF NOT EXISTS distance numeric,
  -- Pitch location (normalized strike-zone coordinates, present whenever
  -- the pitch was tracked)
  ADD COLUMN IF NOT EXISTS pz_norm numeric,
  ADD COLUMN IF NOT EXISTS px_norm numeric,
  -- TruMedia-supplied per-pitch xStats (present on batted-in-play rows).
  -- We aggregate these as season xAVG / xSLG / xwOBA for cross-check
  -- against our own (EV, LA) bucket-derived xStats. Field naming matches
  -- TruMedia's column names so the ingest mapping reads cleanly.
  ADD COLUMN IF NOT EXISTS x_avg numeric,
  ADD COLUMN IF NOT EXISTS x_slg numeric,
  ADD COLUMN IF NOT EXISTS x_woba numeric;

-- Index on pitch location for fast zone-based queries (heart/shadow/chase
-- filters on the Stats page will scan by px_norm/pz_norm ranges).
CREATE INDEX IF NOT EXISTS idx_pitch_log_location
  ON public.pitch_log(px_norm, pz_norm)
  WHERE px_norm IS NOT NULL AND pz_norm IS NOT NULL;

-- Index on spray_ang for batted-ball spray queries (spray chart by
-- batter_id, by pitch_type, etc.)
CREATE INDEX IF NOT EXISTS idx_pitch_log_batter_spray
  ON public.pitch_log(batter_id, spray_ang)
  WHERE spray_ang IS NOT NULL;
