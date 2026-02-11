
-- Table for storing model equation weights/config
CREATE TABLE public.model_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_type TEXT NOT NULL, -- 'transfer' or 'returner'
  config_key TEXT NOT NULL,
  config_value NUMERIC NOT NULL,
  season INTEGER NOT NULL DEFAULT 2025,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(model_type, config_key, season)
);

ALTER TABLE public.model_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read model_config"
ON public.model_config FOR SELECT USING (true);

CREATE POLICY "Staff can manage model_config"
ON public.model_config FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_model_config_updated_at
BEFORE UPDATE ON public.model_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table for storing player prediction outputs
CREATE TABLE public.player_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  model_type TEXT NOT NULL, -- 'transfer' or 'returner'
  variant TEXT NOT NULL DEFAULT 'regular', -- 'regular' or 'xstats'
  season INTEGER NOT NULL DEFAULT 2025,
  
  -- Input stats
  from_avg NUMERIC,
  from_obp NUMERIC,
  from_slg NUMERIC,
  
  -- Class transition (returner)
  class_transition TEXT, -- 'FS', 'SJ', 'JS', 'GR'
  dev_aggressiveness NUMERIC,
  
  -- Conference adjustments (transfer)
  from_avg_plus NUMERIC,
  from_obp_plus NUMERIC,
  from_slg_plus NUMERIC,
  to_avg_plus NUMERIC,
  to_obp_plus NUMERIC,
  to_slg_plus NUMERIC,
  from_stuff_plus NUMERIC,
  to_stuff_plus NUMERIC,
  from_park_factor NUMERIC,
  to_park_factor NUMERIC,
  
  -- Power rating scores
  ev_score NUMERIC,
  barrel_score NUMERIC,
  whiff_score NUMERIC,
  chase_score NUMERIC,
  power_rating_score NUMERIC,
  power_rating_plus NUMERIC,
  
  -- Predicted outputs
  p_avg NUMERIC,
  p_obp NUMERIC,
  p_slg NUMERIC,
  p_ops NUMERIC,
  p_iso NUMERIC,
  p_wrc NUMERIC,
  p_wrc_plus NUMERIC,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(player_id, model_type, variant, season)
);

ALTER TABLE public.player_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read player_predictions"
ON public.player_predictions FOR SELECT USING (true);

CREATE POLICY "Staff can manage player_predictions"
ON public.player_predictions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

CREATE TRIGGER update_player_predictions_updated_at
BEFORE UPDATE ON public.player_predictions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
