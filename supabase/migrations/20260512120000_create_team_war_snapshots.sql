-- =================================================================
-- team_war_snapshots
-- =================================================================
-- Stores per-season WAR aggregations for every D1 team. Powers:
--   1. Year-over-year same-team compare (customer team 2026 build vs 2025 actual)
--   2. Championship benchmark compare (build vs national/conference champ)
--   3. Conference avg/median reference lines
--
-- Seeded by supabase/queries/seed_team_war_snapshots_2025.sql which runs
-- the aggregation defined in team_war_2025_aggregation.sql plus UPDATEs
-- for the 1 national champ + 39 conference champion flags marked
-- 2026-05-12. Refreshed annually via Admin button.
-- =================================================================

CREATE TABLE IF NOT EXISTS team_war_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  source_team_id text NOT NULL,
  team_name text NOT NULL,
  conference text,

  is_national_champ boolean NOT NULL DEFAULT false,
  is_conference_champ boolean NOT NULL DEFAULT false,

  -- Raw (actual season totals, schedule-length dependent)
  raw_total_owar numeric NOT NULL DEFAULT 0,
  raw_total_pwar numeric NOT NULL DEFAULT 0,
  raw_starting_lineup_owar numeric NOT NULL DEFAULT 0,
  raw_rotation_pwar numeric NOT NULL DEFAULT 0,
  raw_bullpen_pwar numeric NOT NULL DEFAULT 0,

  -- Prorated to 56-game regular season (cross-conference fair comparison)
  prorated_total_owar numeric NOT NULL DEFAULT 0,
  prorated_total_pwar numeric NOT NULL DEFAULT 0,
  prorated_starting_lineup_owar numeric NOT NULL DEFAULT 0,
  prorated_rotation_pwar numeric NOT NULL DEFAULT 0,
  prorated_bullpen_pwar numeric NOT NULL DEFAULT 0,

  games_played_est integer,
  proration_factor numeric,
  n_hitters integer,
  n_pitchers integer,
  notes text,
  computed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (season, source_team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_war_snapshots_lookup
  ON team_war_snapshots (season, source_team_id);

CREATE INDEX IF NOT EXISTS idx_team_war_snapshots_champs
  ON team_war_snapshots (season, is_national_champ, is_conference_champ);

CREATE INDEX IF NOT EXISTS idx_team_war_snapshots_conf
  ON team_war_snapshots (season, conference);

-- RLS: public reference data, all authenticated users can read.
-- Writes happen via service role (Admin button) only.
ALTER TABLE team_war_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read team_war_snapshots" ON team_war_snapshots;
CREATE POLICY "Authenticated users can read team_war_snapshots"
  ON team_war_snapshots
  FOR SELECT
  TO authenticated
  USING (true);
