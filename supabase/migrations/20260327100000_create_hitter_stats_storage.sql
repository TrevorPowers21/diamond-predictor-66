CREATE TABLE IF NOT EXISTS public.hitter_stats_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  team text,
  conference text,
  season integer NOT NULL DEFAULT 2025,
  avg numeric,
  obp numeric,
  slg numeric,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_name, team, season)
);

ALTER TABLE public.hitter_stats_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read hitter_stats_storage"
ON public.hitter_stats_storage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Staff can manage hitter_stats_storage"
ON public.hitter_stats_storage
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_hitter_stats_storage_updated_at
BEFORE UPDATE ON public.hitter_stats_storage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
