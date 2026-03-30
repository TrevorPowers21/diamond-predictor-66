CREATE TABLE IF NOT EXISTS public.pitch_arsenal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE,
  player_name text NOT NULL,
  hand text,
  pitch_type text NOT NULL,
  stuff_plus numeric,
  usage_pct numeric,
  whiff_pct numeric,
  pitch_count integer,
  total_pitches integer,
  overall_stuff_plus numeric,
  source_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, player_name, hand, pitch_type)
);

ALTER TABLE public.pitch_arsenal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitch_arsenal"
ON public.pitch_arsenal
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Staff can manage pitch_arsenal"
ON public.pitch_arsenal
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_pitch_arsenal_updated_at
BEFORE UPDATE ON public.pitch_arsenal
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
