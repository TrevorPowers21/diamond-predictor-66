-- Helper to surface team member emails in the /admin/users page.
--
-- auth.users is not exposed to PostgREST (correct — emails would otherwise
-- be enumerable by any authenticated user), so we expose a narrow function
-- that returns emails ONLY for members of a team the caller is allowed to
-- manage:
--   - Superadmins: any team
--   - Team admins: their own team
--   - Anyone else: empty result
--
-- SECURITY DEFINER lets the function read auth.users despite the caller's
-- privileges. Authorization is enforced inside the body.

CREATE OR REPLACE FUNCTION public.get_team_member_emails(_team_id uuid)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_admin_of(_team_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text
  FROM auth.users u
  INNER JOIN public.user_team_access uta ON uta.user_id = u.id
  WHERE uta.customer_team_id = _team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_member_emails(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_member_emails(uuid) TO authenticated;
