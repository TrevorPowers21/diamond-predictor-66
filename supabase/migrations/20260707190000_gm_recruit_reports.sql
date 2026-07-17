-- Multiple scouting reports per recruit — each authored by a coach on a date,
-- independent (adding/removing one never touches another). Replaces the single
-- notes/scouting_report_date field going forward.
CREATE TABLE IF NOT EXISTS public.gm_recruit_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id         uuid NOT NULL REFERENCES public.gm_recruits(id) ON DELETE CASCADE,
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  author             text,                            -- who wrote it (email/name snapshot)
  report_date        date NOT NULL DEFAULT current_date,
  body               text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruit_reports_recruit ON public.gm_recruit_reports (recruit_id);

ALTER TABLE public.gm_recruit_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruit_reports_all ON public.gm_recruit_reports;
CREATE POLICY gm_recruit_reports_all ON public.gm_recruit_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
