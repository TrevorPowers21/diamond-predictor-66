-- ============================================================================
-- player_predictions — scope SELECT by team access
--
-- WHY
--   The policy was `SELECT USING (true)` for {public}: every authenticated user could read EVERY
--   prediction row for EVERY program, including team-scoped precomputed valuations. The app already
--   restricts reads to the user's own team via applyTeamScopeFilter(), but that runs in the BROWSER.
--   A user with their own valid JWT could call PostgREST directly —
--       GET /rest/v1/player_predictions?customer_team_id=eq.<other_team>
--   — and the database had no reason to refuse. Identity was enforced (user_team_access is locked to
--   superadmin / team_admin, so nobody can reassign their own team); the DATA boundary was not.
--
--   Exposed: per-destination-team projections and market values, i.e. what each program's model says
--   a given transfer is worth to them.
--
-- WHAT CHANGES
--   Global rows (customer_team_id IS NULL) stay readable by everyone — they are the shared
--   returner/reference population every surface falls back to. Team-scoped rows become visible only
--   to that team, its team_admin, and superadmins.
--
--   This MIRRORS what the app already queries, so no application change is needed. It moves the
--   boundary from convention to enforcement.
--
-- VERIFIED BEFORE WRITING (2026-09-02)
--   * every call site passes effectiveTeamId, which resolves from user_team_access server-side
--   * PlayerComparison's `destTeamId` is `= effectiveTeamId` (line 139) — not a cross-team read
--   * the WAR benchmark / comparison cards read team_war_snapshots, a DIFFERENT table, unaffected
--   * WRITES are unchanged: 'Staff can manage player_predictions' (admin/staff) still governs them
--   * has_role() and is_team_admin_of() are both SECURITY DEFINER, so no policy recursion
--
-- ROLLBACK
--   supabase/rollback/20260902120000_player_predictions_scope_select_by_team_rollback.sql
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Authenticated users can read player_predictions" ON public.player_predictions;

CREATE POLICY "Team-scoped read of player_predictions"
  ON public.player_predictions
  FOR SELECT
  TO authenticated
  USING (
    -- shared reference population: global returner/regular rows
    customer_team_id IS NULL
    -- superadmins see everything (the "all clients" view is additionally backend-gated)
    OR has_role(auth.uid(), 'superadmin'::app_role)
    -- a team's own precomputed rows
    OR EXISTS (
      SELECT 1 FROM public.user_team_access uta
      WHERE uta.user_id = auth.uid()
        AND uta.customer_team_id = player_predictions.customer_team_id
    )
    -- a team_admin managing that team
    OR is_team_admin_of(customer_team_id)
  );

COMMIT;
