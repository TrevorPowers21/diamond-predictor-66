CREATE TABLE IF NOT EXISTS public.pitching_power_ratings_storage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  player_name text,
  team text,
  stuff_plus numeric,
  whiff_pct numeric,
  bb_pct numeric,
  hh_pct numeric,
  iz_whiff_pct numeric,
  chase_pct numeric,
  barrel_pct numeric,
  ld_pct numeric,
  avg_exit_velo numeric,
  gb_pct numeric,
  iz_pct numeric,
  ev90 numeric,
  pull_pct numeric,
  la_10_30_pct numeric,
  stuff_score integer,
  whiff_score integer,
  bb_score integer,
  hh_score integer,
  iz_whiff_score integer,
  chase_score integer,
  barrel_score integer,
  ld_score integer,
  avg_ev_score integer,
  gb_score integer,
  iz_score integer,
  ev90_score integer,
  pull_score integer,
  la_10_30_score integer,
  era_pr_plus integer,
  fip_pr_plus integer,
  whip_pr_plus integer,
  k9_pr_plus integer,
  hr9_pr_plus integer,
  bb9_pr_plus integer,
  overall_pr_plus integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, season)
);

ALTER TABLE public.pitching_power_ratings_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitching_power_ratings_storage"
ON public.pitching_power_ratings_storage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Staff can manage pitching_power_ratings_storage"
ON public.pitching_power_ratings_storage
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_pitching_power_ratings_storage_updated_at
BEFORE UPDATE ON public.pitching_power_ratings_storage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

