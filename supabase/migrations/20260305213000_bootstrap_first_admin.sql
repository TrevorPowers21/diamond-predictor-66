-- Allow a brand-new project to self-bootstrap exactly one admin role.
-- This only applies when no admin exists yet.
CREATE POLICY "Bootstrap first admin role"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'admin'::public.app_role
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE role = 'admin'::public.app_role
    )
  );
