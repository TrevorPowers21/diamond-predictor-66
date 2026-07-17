-- The projection tier is authored with each scouting report — an assistant sets
-- it on June 7, the head coach can revise it on June 14 with a fresh report.
-- Store the tier that accompanied each report (history), and mirror the latest
-- onto gm_recruits.projection_tier for the stable card badge.
ALTER TABLE public.gm_recruit_reports
  ADD COLUMN IF NOT EXISTS projection_tier text;
