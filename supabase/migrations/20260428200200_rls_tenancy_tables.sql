-- Step 4c — RLS for the tenancy infrastructure tables.
--
-- customer_teams + user_team_access were created with RLS enabled but no
-- policies (Step 1), so they are currently unreadable/unwriteable except
-- via the service role. This migration grants the right access.

-- ─────────────────────────────────────────────────────────────────────
-- customer_teams
--   Read:  superadmin OR member of the team
--   Write: superadmin only (creating teams, toggling savant/active)
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "customer_teams_select" ON public.customer_teams
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(id)
  );

CREATE POLICY "customer_teams_modify" ON public.customer_teams
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ─────────────────────────────────────────────────────────────────────
-- user_team_access
--   Read:  superadmin sees all
--          users see their own row
--          team_admins see all rows on their own team (for /admin/users)
--   Write: superadmin only — invite flow goes through the Edge Function
--          which uses the service role key and bypasses RLS
-- ─────────────────────────────────────────────────────────────────────
CREATE POLICY "user_team_access_select" ON public.user_team_access
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR user_id = auth.uid()
    OR public.is_team_admin_of(customer_team_id)
  );

CREATE POLICY "user_team_access_modify" ON public.user_team_access
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role));
