
-- Trigger to prevent updates to locked prediction records (except unlocking)
CREATE OR REPLACE FUNCTION public.prevent_locked_prediction_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If the record is locked and we're not just unlocking it, prevent the update
  IF OLD.locked = true AND NEW.locked = true THEN
    -- Allow status changes (e.g. departed) but block stat/scouting overwrites
    NEW.p_avg := OLD.p_avg;
    NEW.p_obp := OLD.p_obp;
    NEW.p_slg := OLD.p_slg;
    NEW.p_ops := OLD.p_ops;
    NEW.p_iso := OLD.p_iso;
    NEW.p_wrc := OLD.p_wrc;
    NEW.p_wrc_plus := OLD.p_wrc_plus;
    NEW.from_avg := OLD.from_avg;
    NEW.from_obp := OLD.from_obp;
    NEW.from_slg := OLD.from_slg;
    NEW.ev_score := OLD.ev_score;
    NEW.barrel_score := OLD.barrel_score;
    NEW.whiff_score := OLD.whiff_score;
    NEW.chase_score := OLD.chase_score;
    NEW.power_rating_plus := OLD.power_rating_plus;
    NEW.power_rating_score := OLD.power_rating_score;
    NEW.from_park_factor := OLD.from_park_factor;
    NEW.to_park_factor := OLD.to_park_factor;
    NEW.from_stuff_plus := OLD.from_stuff_plus;
    NEW.to_stuff_plus := OLD.to_stuff_plus;
    NEW.from_avg_plus := OLD.from_avg_plus;
    NEW.from_obp_plus := OLD.from_obp_plus;
    NEW.from_slg_plus := OLD.from_slg_plus;
    NEW.to_avg_plus := OLD.to_avg_plus;
    NEW.to_obp_plus := OLD.to_obp_plus;
    NEW.to_slg_plus := OLD.to_slg_plus;
    NEW.dev_aggressiveness := OLD.dev_aggressiveness;
    NEW.class_transition := OLD.class_transition;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER protect_locked_predictions
BEFORE UPDATE ON public.player_predictions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_locked_prediction_update();
