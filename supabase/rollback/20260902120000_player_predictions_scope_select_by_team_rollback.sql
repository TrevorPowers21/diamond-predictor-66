-- Rollback for 20260902120000_player_predictions_scope_select_by_team.sql
--
-- Restores the previous wide-open SELECT policy on player_predictions.
--
-- ⚠ Applying this REOPENS cross-program reads: any authenticated user can again read every
--   prediction row for every program, including other teams' precomputed valuations. Only run it if
--   the scoped policy is actively breaking a surface, and treat that as a bug to fix rather than a
--   state to stay in.

BEGIN;

DROP POLICY IF EXISTS "Team-scoped read of player_predictions" ON public.player_predictions;

CREATE POLICY "Authenticated users can read player_predictions"
  ON public.player_predictions
  FOR SELECT
  USING (true);

COMMIT;
