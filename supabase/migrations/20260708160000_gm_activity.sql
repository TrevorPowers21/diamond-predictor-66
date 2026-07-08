-- Front-office activity log — a team-shared feed of who did what (added a
-- recruit, removed players, changed the budget, wrote a note/report). Each GM
-- mutation appends one row; the dashboard reads the most recent.
CREATE TABLE IF NOT EXISTS public.gm_activity (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  actor              text,             -- who did it (email snapshot)
  action             text NOT NULL,    -- human phrase, e.g. "added a note on Nolan Traeger"
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_activity_team ON public.gm_activity (customer_team_id, created_at DESC);

ALTER TABLE public.gm_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_activity_all ON public.gm_activity;
CREATE POLICY gm_activity_all ON public.gm_activity
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
