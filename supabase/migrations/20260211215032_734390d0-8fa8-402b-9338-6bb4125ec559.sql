-- Add status column to player_predictions
ALTER TABLE public.player_predictions
ADD COLUMN status text NOT NULL DEFAULT 'active';

-- Index for fast filtering
CREATE INDEX idx_player_predictions_status ON public.player_predictions(status);
