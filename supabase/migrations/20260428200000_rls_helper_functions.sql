-- Step 4a — RLS helper functions for multi-tenant access control.
--
-- Both functions are SECURITY DEFINER so they execute with the function
-- owner's privileges — this is required when a function reads from a table
-- whose RLS policies reference the function itself (otherwise the policy
-- evaluation recurses).
--
-- Pattern matches the existing public.has_role() helper.

CREATE OR REPLACE FUNCTION public.is_team_member(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_team_access
    WHERE user_id = auth.uid()
      AND customer_team_id = _team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin_of(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_team_access
    WHERE user_id = auth.uid()
      AND customer_team_id = _team_id
      AND role = 'team_admin'
  );
$$;
