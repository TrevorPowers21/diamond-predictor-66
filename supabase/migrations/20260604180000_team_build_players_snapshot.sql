-- Add player_snapshot column to team_build_players.
-- Stores a JSONB snapshot of the precomputed player_predictions row at save
-- time so builds load instantly from one DB read instead of re-fetching
-- player_predictions + pitching master on every load.
--
-- Shape: all fields needed by playerProjection for display + overlay math.
-- Base values only (no depth/devAgg overlay applied) — overlays re-apply
-- client-side from production_notes.depth_role + dev_aggressiveness.
--
-- Refreshed by:
--   1. Coach saves build (client writes fresh snapshot)
--   2. Precompute pipeline (process-precompute-jobs UPDATE after each team run)

ALTER TABLE public.team_build_players
  ADD COLUMN IF NOT EXISTS player_snapshot JSONB;

-- Fast lookup for precompute UPDATE and fallback prediction fetch
CREATE INDEX IF NOT EXISTS idx_tbp_player_id
  ON public.team_build_players(player_id);

CREATE INDEX IF NOT EXISTS idx_tbp_build_id
  ON public.team_build_players(build_id);
