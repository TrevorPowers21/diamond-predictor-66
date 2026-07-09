-- Reference the record an activity entry is about (note id, report id, recruit
-- id) so that when that record is deleted we can remove its stale activity from
-- the feed, and the entry's link can deep-link to open it.
ALTER TABLE public.gm_activity
  ADD COLUMN IF NOT EXISTS ref_id text;

CREATE INDEX IF NOT EXISTS idx_gm_activity_ref ON public.gm_activity (ref_id);
