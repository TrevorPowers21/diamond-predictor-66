-- Add per-conference hitter + pitcher scouting score columns to Conference Stats.
-- Populated by computeConferenceScoutingAverages():
--   * Hitter scores PA-weighted from Hitter Master
--   * Pitcher scores IP-weighted from Pitching Master
-- Existing barrel_score / chase_score / ev_score / whiff_score columns left
-- intact for backward-compatible UI display.

ALTER TABLE "Conference Stats"
  -- Hitter scouting (11)
  ADD COLUMN IF NOT EXISTS hitter_contact_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_line_drive_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_avg_ev_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_pop_up_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_bb_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_chase_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_barrel_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_ev90_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_pull_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_la_score NUMERIC,
  ADD COLUMN IF NOT EXISTS hitter_gb_score NUMERIC,
  -- Pitcher scouting (13)
  ADD COLUMN IF NOT EXISTS pitcher_whiff_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_bb_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_hh_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_iz_whiff_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_chase_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_barrel_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_ld_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_ev_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_gb_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_iz_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_ev90_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_pull_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_la_score NUMERIC;
