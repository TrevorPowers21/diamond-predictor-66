-- Rollback for 20260902120000_player_predictions_scope_select_by_team.sql
--
-- ⚠ STAGING ONLY, and almost certainly not what you want.
--
-- That migration made STAGING match PROD. Rolling it back restores staging's old `USING (true)` —
-- reopening cross-program reads on staging AND re-introducing the config drift between the two
-- databases that caused the original mis-diagnosis. Prod is unaffected either way; prod already had
-- the scoped policy and this migration was never applied there.
--
-- If a surface breaks under the scoped policy, that is a bug in the surface. Fix it there.

BEGIN;

DROP POLICY IF EXISTS player_predictions_select_team_scoped ON public.player_predictions;

CREATE POLICY "Authenticated users can read player_predictions"
  ON public.player_predictions
  FOR SELECT
  USING (true);

COMMIT;
