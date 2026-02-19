
-- Internal power ratings table - admin only
CREATE TABLE public.player_prediction_internals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id uuid NOT NULL REFERENCES public.player_predictions(id) ON DELETE CASCADE,
  avg_power_rating numeric,
  obp_power_rating numeric,
  slg_power_rating numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(prediction_id)
);

ALTER TABLE public.player_prediction_internals ENABLE ROW LEVEL SECURITY;

-- Only admins can read
CREATE POLICY "Admins can read internal ratings"
  ON public.player_prediction_internals
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin/staff can manage
CREATE POLICY "Admin/staff can manage internal ratings"
  ON public.player_prediction_internals
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- Timestamp trigger
CREATE TRIGGER update_player_prediction_internals_updated_at
  BEFORE UPDATE ON public.player_prediction_internals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
