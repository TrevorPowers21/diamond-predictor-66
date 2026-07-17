-- Let team admins manage their OWN team's members. The Admin → Users page is
-- open to superadmin + team_admin (RoleGuard), and scopes a team_admin to their
-- own team, but the only modify policy on user_team_access was superadmin-only —
-- so a team_admin's add/remove silently affected 0 rows (RLS filtered it out,
-- no error) and the UI falsely reported success. This adds a team_admin modify
-- policy scoped to their own team. Uses the SECURITY DEFINER helper
-- is_team_admin_of() so the policy doesn't recurse on user_team_access.
-- Superadmin keeps its existing separate policy (permissive policies are OR'd).

DROP POLICY IF EXISTS "user_team_access_team_admin_modify" ON public.user_team_access;
CREATE POLICY "user_team_access_team_admin_modify" ON public.user_team_access
  FOR ALL
  TO authenticated
  USING (public.is_team_admin_of(customer_team_id))
  WITH CHECK (public.is_team_admin_of(customer_team_id));

NOTIFY pgrst, 'reload schema';
