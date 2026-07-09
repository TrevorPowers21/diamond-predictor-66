-- Recruiting scholarship offer (as a % of one scholarship) on each recruit, and
-- a per-class-year config for the recruiting budget target + scholarships
-- available. Both team-scoped, RLS like the rest of the GM tables.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS scholarship_pct numeric;  -- % of one scholarship offered

CREATE TABLE IF NOT EXISTS public.gm_class_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  class_year         integer NOT NULL,
  budget             numeric,   -- recruiting budget target for the class
  scholarships       numeric,   -- scholarships available for the class (equivalencies)
  updated_by_user_id uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, class_year)
);

ALTER TABLE public.gm_class_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_class_config_all ON public.gm_class_config;
CREATE POLICY gm_class_config_all ON public.gm_class_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
