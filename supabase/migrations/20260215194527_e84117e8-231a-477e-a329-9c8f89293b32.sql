
-- Add locked column to player_predictions
ALTER TABLE public.player_predictions 
ADD COLUMN locked boolean NOT NULL DEFAULT false;

-- Lock all 2025 prediction records (stats + scouting grades)
UPDATE public.player_predictions 
SET locked = true 
WHERE season = 2025;
