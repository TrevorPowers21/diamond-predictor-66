-- Mirror the hitter output pattern for pitchers.
-- Hitters persist p_avg / p_obp / p_slg / p_wrc / p_wrc_plus; pitchers have
-- had to recompute p_era / p_fip / p_whip / p_k9 / p_bb9 / p_hr9 / p_rv_plus
-- inline on every page. This migration adds the columns so the recalc engine
-- can write them once and every surface (Team Builder, High Follow, Returning
-- Players, Pitcher Profile, Transfer Portal) can read the same values.
--
-- pWAR and market_value remain live-derived from p_rv_plus + projected role
-- + team/conference, matching how hitter oWAR and NIL value are handled.

ALTER TABLE public.player_predictions
  ADD COLUMN IF NOT EXISTS p_era NUMERIC,
  ADD COLUMN IF NOT EXISTS p_fip NUMERIC,
  ADD COLUMN IF NOT EXISTS p_whip NUMERIC,
  ADD COLUMN IF NOT EXISTS p_k9 NUMERIC,
  ADD COLUMN IF NOT EXISTS p_bb9 NUMERIC,
  ADD COLUMN IF NOT EXISTS p_hr9 NUMERIC,
  ADD COLUMN IF NOT EXISTS p_rv_plus NUMERIC,
  ADD COLUMN IF NOT EXISTS pitcher_role TEXT;

-- Constrain pitcher_role so only valid engine outputs can be persisted.
-- Nullable: hitter rows leave it NULL.
ALTER TABLE public.player_predictions
  DROP CONSTRAINT IF EXISTS player_predictions_pitcher_role_check;

ALTER TABLE public.player_predictions
  ADD CONSTRAINT player_predictions_pitcher_role_check
  CHECK (pitcher_role IS NULL OR pitcher_role IN ('SP', 'RP', 'SM'));

-- Round out the internal power-rating table. era/fip/whip already exist;
-- add the three remaining pitcher rates so admins can inspect every input.
ALTER TABLE public.player_prediction_internals
  ADD COLUMN IF NOT EXISTS k9_power_rating NUMERIC,
  ADD COLUMN IF NOT EXISTS bb9_power_rating NUMERIC,
  ADD COLUMN IF NOT EXISTS hr9_power_rating NUMERIC;
