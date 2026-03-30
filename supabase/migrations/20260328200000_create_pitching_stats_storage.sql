-- Pitching stats storage: mirrors localStorage pitching_stats_storage_2025_v1
-- Uses player_name+team+season as key (no FK required) so CSV-imported
-- pitchers work before being linked to a players record.

CREATE TABLE IF NOT EXISTS public.pitching_stats_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid,
  player_name text NOT NULL,
  team text,
  handedness text,
  role text,
  season integer NOT NULL DEFAULT 2025,
  era numeric,
  fip numeric,
  whip numeric,
  k9 numeric,
  bb9 numeric,
  hr9 numeric,
  ip numeric,
  g integer,
  gs integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_name, team, season)
);

ALTER TABLE public.pitching_stats_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitching_stats_storage"
ON public.pitching_stats_storage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Staff can manage pitching_stats_storage"
ON public.pitching_stats_storage
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_pitching_stats_storage_updated_at
BEFORE UPDATE ON public.pitching_stats_storage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Also make pitching_power_ratings_storage.player_id nullable
-- so CSV-imported pitchers can be stored before linking.
ALTER TABLE public.pitching_power_ratings_storage
  ALTER COLUMN player_id DROP NOT NULL;

-- Add name-based unique constraint for upsert support
ALTER TABLE public.pitching_power_ratings_storage
  DROP CONSTRAINT IF EXISTS pitching_power_ratings_storage_player_id_season_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pitching_power_ratings_storage_name_team_season_key'
  ) THEN
    ALTER TABLE public.pitching_power_ratings_storage
      ADD CONSTRAINT pitching_power_ratings_storage_name_team_season_key
      UNIQUE (player_name, team, season);
  END IF;
END $$;
