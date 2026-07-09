-- Optional deep-link on an activity entry so a coach can click to review the
-- change (e.g. the recruiting board or roster page where it happened).
ALTER TABLE public.gm_activity
  ADD COLUMN IF NOT EXISTS link text;
