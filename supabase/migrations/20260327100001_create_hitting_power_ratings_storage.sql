CREATE TABLE IF NOT EXISTS public.hitting_power_ratings_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  team text,
  season integer NOT NULL DEFAULT 2025,
  position text,
  contact numeric,
  line_drive numeric,
  avg_exit_velo numeric,
  pop_up numeric,
  bb numeric,
  chase numeric,
  barrel numeric,
  ev90 numeric,
  pull numeric,
  la_10_30 numeric,
  gb numeric,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_name, team, season)
);

ALTER TABLE public.hitting_power_ratings_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read hitting_power_ratings_storage"
ON public.hitting_power_ratings_storage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Staff can manage hitting_power_ratings_storage"
ON public.hitting_power_ratings_storage
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_hitting_power_ratings_storage_updated_at
BEFORE UPDATE ON public.hitting_power_ratings_storage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
