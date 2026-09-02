-- ============================================================================
-- player_predictions — align STAGING's SELECT policy with the one PROD already has
--
-- ⛔ DO NOT APPLY TO PROD. Prod already has this policy. Applying would add a second, redundant
--    SELECT policy alongside `player_predictions_select_team_scoped`.
--
-- CORRECTED 2026-09-02 — the original version of this file claimed to close a PRODUCTION security
-- hole. That was wrong, and the error is worth recording because it is Gate B repeating:
--
--   PROD    player_predictions_select_team_scoped
--           USING (customer_team_id IS NULL
--                  OR has_role(auth.uid(), 'superadmin') OR is_team_member(customer_team_id))
--   STAGING USING (true)                                   ← the actual problem
--
-- The RLS analysis was run with its default target (STAGING) and reported as though it described
-- prod. Same code, two databases, different config — exactly the shape of Gate B, where prod ran a
-- different wRC+ equation because a legacy table existed there and not on staging.
-- ⇒ VERIFY CONFIG ON BOTH DATABASES. The finding was real; the database it applied to was not.
--
-- WHAT THIS DOES
--   Replaces staging's `USING (true)` with prod's policy, copied VERBATIM — same name, same
--   expression, same role. An earlier attempt used an equivalent-but-differently-written policy
--   (an inline EXISTS plus a redundant `is_team_admin_of`), which left the two databases holding
--   two spellings of one rule. That is the drift this file now removes.
--
--   Writes are untouched: "Staff can manage player_predictions" (admin/staff) still governs them.
--
-- VERIFIED
--   * is_team_member(uuid) exists on BOTH databases, STABLE SECURITY DEFINER, search_path=public,
--     and is exactly `EXISTS (SELECT 1 FROM user_team_access WHERE user_id = auth.uid()
--     AND customer_team_id = _team_id)` — so no policy recursion.
--   * on prod, with a real non-superadmin coach (Gardner-Webb, general_user, no user_roles row):
--     own team 14,268 rows visible - other team 0 - global 31,369 readable.
--
-- ROLLBACK
--   supabase/rollback/20260902120000_player_predictions_scope_select_by_team_rollback.sql
-- ============================================================================

BEGIN;

-- staging's wide-open policy
DROP POLICY IF EXISTS "Authenticated users can read player_predictions" ON public.player_predictions;
-- the equivalent-but-differently-written policy from this file's first version
DROP POLICY IF EXISTS "Team-scoped read of player_predictions" ON public.player_predictions;

-- Prod's definition, copied verbatim so the two databases match byte for byte.
CREATE POLICY player_predictions_select_team_scoped
  ON public.player_predictions
  FOR SELECT
  TO authenticated
  USING (
    (customer_team_id IS NULL)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    OR is_team_member(customer_team_id)
  );

COMMIT;
