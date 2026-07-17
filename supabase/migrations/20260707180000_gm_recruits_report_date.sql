-- Date the recruit's scouting report was written (shown + editable in the
-- scouting-report popup).
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS scouting_report_date date;
