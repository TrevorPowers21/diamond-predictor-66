-- Front Office: recruiting board. Future recruiting classes (by year), split
-- position player / pitcher / two-way, hand-ordered like the target board.
-- These carry no projection (HS/JUCO prospects) — just scouting info.
CREATE TABLE IF NOT EXISTS public.gm_recruits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  class_year         integer NOT NULL,                 -- recruiting class (e.g. 2028)
  player_type        text NOT NULL DEFAULT 'hitter',   -- 'hitter' | 'pitcher' | 'twp'
  first_name         text,
  last_name          text,
  high_school        text,
  state              text,
  travel_org         text,
  position           text,
  notes              text,
  link               text,                             -- PBR / PG profile URL
  sort_order         integer NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruits_team_year ON public.gm_recruits (customer_team_id, class_year);

ALTER TABLE public.gm_recruits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruits_all ON public.gm_recruits;
CREATE POLICY gm_recruits_all ON public.gm_recruits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
