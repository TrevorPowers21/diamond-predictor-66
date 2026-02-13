
-- Create conference_stats table with dedicated columns for all important stats
CREATE TABLE public.conference_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conference TEXT NOT NULL,
  season INTEGER NOT NULL,
  -- Raw stats (Columns A-G)
  avg NUMERIC,
  obp NUMERIC,
  slg NUMERIC,
  ops NUMERIC,
  iso NUMERIC,
  wrc NUMERIC,
  -- Columns H-L (hidden/optional, kept for future pitching use)
  ev_score NUMERIC,
  barrel_score NUMERIC,
  whiff_score NUMERIC,
  chase_score NUMERIC,
  offensive_power_rating NUMERIC,
  -- Plus stats (Columns M-R) — critical for transfer portal equation
  avg_plus NUMERIC,
  obp_plus NUMERIC,
  slg_plus NUMERIC,
  ops_plus NUMERIC,
  iso_plus NUMERIC,
  wrc_plus NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conference, season)
);

-- Enable RLS
ALTER TABLE public.conference_stats ENABLE ROW LEVEL SECURITY;

-- Read access for all authenticated users
CREATE POLICY "Authenticated users can view conference stats"
  ON public.conference_stats FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admin/staff can manage
CREATE POLICY "Admin/staff can insert conference stats"
  ON public.conference_stats FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Admin/staff can update conference stats"
  ON public.conference_stats FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'staff'))
  );

CREATE POLICY "Admin/staff can delete conference stats"
  ON public.conference_stats FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'staff'))
  );

-- Timestamp trigger
CREATE TRIGGER update_conference_stats_updated_at
  BEFORE UPDATE ON public.conference_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
