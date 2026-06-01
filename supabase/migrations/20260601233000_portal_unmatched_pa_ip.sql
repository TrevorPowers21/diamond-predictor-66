-- Add GP / AB / IP columns to portal_entries_unmatched so the review queue
-- can be sorted by sample size (PA for hitters, IP for pitchers).

ALTER TABLE public.portal_entries_unmatched
  ADD COLUMN IF NOT EXISTS gp INTEGER,
  ADD COLUMN IF NOT EXISTS ab INTEGER,
  ADD COLUMN IF NOT EXISTS ip NUMERIC;

CREATE INDEX IF NOT EXISTS idx_portal_unmatched_sort
  ON public.portal_entries_unmatched (resolved, reason, ip DESC NULLS LAST, ab DESC NULLS LAST);
