-- gm_vendor: program-level (team-scoped) canonical vendor directory.
-- Contracts + funding sources both point at it; RLS mirrors gm_contract.
-- Slice 1 of the vendor unification (see memory: project_gm_vendor_unification).
CREATE TABLE IF NOT EXISTS public.gm_vendor (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  name               text NOT NULL,
  bucket             text NOT NULL CHECK (bucket IN ('nil','other')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid
);

-- "Recognize existing vendors": case-insensitive, per bucket, per team.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_vendor_team_name_bucket
  ON public.gm_vendor (customer_team_id, lower(name), bucket);

ALTER TABLE public.gm_vendor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_vendor_all ON public.gm_vendor;
CREATE POLICY gm_vendor_all ON public.gm_vendor
  FOR ALL TO authenticated
  USING     (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
