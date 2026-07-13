-- GM "active / live" build: which build is the authoritative one that drives the
-- universal player profiles, projected WAR / market value, program membership,
-- and pay. Exactly one active build per team (app-enforced via setActiveBuild).
--
-- Independent of is_default (last year's stored baseline): the Default Roster
-- itself CAN be the live build if the roster returns intact — a coach just edits
-- it and it saves. Scenario copies are created inactive and only go live when a
-- coach explicitly assigns them under GM Settings → Change Active Roster.
--
-- No backfill: when no build is flagged active yet, the app falls back to the
-- current working-build logic (first non-default, else default), so existing
-- teams keep working until a coach sets one explicitly.

ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
