-- Default Build Architecture
-- Adds is_default + academic_year to team_builds so the system can own one
-- read-only "default roster" per team per year, separate from coach builds.
-- Adds player_snapshot JSONB to team_build_players so loadBuild can serve
-- stats from the snapshot without a separate player_predictions query.

-- team_builds: default flag + academic year
ALTER TABLE team_builds
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;

-- Allow user_id to be NULL for system-owned default builds
ALTER TABLE team_builds ALTER COLUMN user_id DROP NOT NULL;

-- team_build_players: precomputed snapshot for instant stat display on load
ALTER TABLE team_build_players
  ADD COLUMN IF NOT EXISTS player_snapshot JSONB;

-- Index so the UI query "give me the most recent default for this team" is fast
CREATE INDEX IF NOT EXISTS idx_team_builds_default
  ON team_builds (customer_team_id, is_default, updated_at DESC);

-- Backfill academic_year for existing builds from the build name where parseable
-- (e.g. "2027 Roster - Default" → 2027). Rows that don't match stay NULL.
UPDATE team_builds
SET academic_year = (regexp_match(name, '(20[0-9]{2})'))[1]::integer
WHERE academic_year IS NULL
  AND name ~ '20[0-9]{2}';
