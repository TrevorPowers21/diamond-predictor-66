-- Persist Team Builder depth chart state on saved builds.
-- Stores the manual coach picks for each position-depth slot so the chart
-- survives reload, device switches, and "Save / Load" round-trips.

ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS depth_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS depth_placeholders jsonb NOT NULL DEFAULT '{}'::jsonb;
