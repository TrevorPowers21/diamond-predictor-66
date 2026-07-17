-- Recruiting timeline: dated events per recruit (a coach logs the journey —
-- calls, visits, camps, etc.). The recruit's own `notes` field is the static
-- scouting report; these events are the running log, each with its own note.
CREATE TABLE IF NOT EXISTS public.gm_recruit_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id         uuid NOT NULL REFERENCES public.gm_recruits(id) ON DELETE CASCADE,
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  event_date         date NOT NULL DEFAULT current_date,
  note               text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruit_events_recruit ON public.gm_recruit_events (recruit_id);

ALTER TABLE public.gm_recruit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruit_events_all ON public.gm_recruit_events;
CREATE POLICY gm_recruit_events_all ON public.gm_recruit_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
