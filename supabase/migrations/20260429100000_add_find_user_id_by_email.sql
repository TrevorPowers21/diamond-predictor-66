-- Helper for the invite-user-to-team Edge Function: look up an existing
-- auth.users row by email so we can attach already-registered users to a
-- customer team without sending a duplicate magic-link invite.
--
-- SECURITY DEFINER lets the function read auth.users (which is locked down
-- from PostgREST by default). EXECUTE is granted only to service_role so
-- it cannot be called from the browser by an authenticated user.

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users WHERE email = _email LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO service_role;
