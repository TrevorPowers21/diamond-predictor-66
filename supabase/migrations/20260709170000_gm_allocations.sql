-- GM Allocations: named funding categories, each in a bucket (NIL vendor or
-- Other), with a total pool and per-player allocations tracked against it.
-- A "source" is a category the GM creates (name + bucket + total). An
-- "allocation" assigns part of that source's total to a specific player.
-- Remaining = total - SUM(allocations). Team-scoped + RLS like every GM table.

CREATE TABLE IF NOT EXISTS public.gm_allocation_source (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  name               text NOT NULL,
  bucket             text NOT NULL CHECK (bucket IN ('nil', 'other')),
  total              numeric,
  sort_order         integer NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_allocation_source_team ON public.gm_allocation_source (customer_team_id, bucket);

ALTER TABLE public.gm_allocation_source ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_allocation_source_all ON public.gm_allocation_source;
CREATE POLICY gm_allocation_source_all ON public.gm_allocation_source
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

CREATE TABLE IF NOT EXISTS public.gm_allocation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  source_id          uuid NOT NULL REFERENCES public.gm_allocation_source(id) ON DELETE CASCADE,
  player_id          uuid NOT NULL,
  amount             numeric,
  updated_by_user_id uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_allocation_source ON public.gm_allocation (source_id);

ALTER TABLE public.gm_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_allocation_all ON public.gm_allocation;
CREATE POLICY gm_allocation_all ON public.gm_allocation
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

NOTIFY pgrst, 'reload schema';
