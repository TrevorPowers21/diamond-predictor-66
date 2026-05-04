-- Add per-conference RAW rate columns to Conference Stats so the Savant page
-- can display the actual rate values alongside the 0–100 percentile scores
-- and Power Ratings. PA-weighted from Hitter Master, IP-weighted from Pitching
-- Master. Populated by computeConferenceScoutingAverages().

ALTER TABLE "Conference Stats"
  -- Hitter raw rates (11)
  ADD COLUMN IF NOT EXISTS hitter_contact_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_line_drive_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_avg_ev NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_pop_up_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_bb_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_chase_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_barrel_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_ev90 NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_pull_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_la_10_30_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_gb_pct NUMERIC,

  -- Pitcher raw rates (13)
  ADD COLUMN IF NOT EXISTS pitcher_whiff_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_bb_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_hard_hit_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_iz_whiff_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_chase_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_barrel_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_line_drive_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_exit_velo NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_ground_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_in_zone_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_ev90 NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_pull_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_la_10_30_pct NUMERIC;
