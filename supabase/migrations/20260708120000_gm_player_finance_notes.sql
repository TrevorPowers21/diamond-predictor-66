-- Per-player GM notes — scouting/negotiation context on an individual roster
-- row, keyed per build (build_player_id). Supersedes the per-build
-- team_builds.gm_notes; notes belong on the player, not the whole build.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS notes text;
