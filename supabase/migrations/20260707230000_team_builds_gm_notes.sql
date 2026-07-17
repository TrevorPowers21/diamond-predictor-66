-- Internal GM notes on a roster build — the front-office "profile" for this
-- scenario (context, philosophy, reminders). Lives on team_builds so it's
-- team-scoped and shared across the coaching staff; the coach-facing Team
-- Builder simply ignores it.
ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS gm_notes text;
