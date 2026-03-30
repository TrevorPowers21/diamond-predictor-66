-- Add optional player_id column to hitter storage tables for UUID-based lookups.
-- This does NOT add a foreign key constraint so seed rows can exist before
-- a corresponding players record is created.

ALTER TABLE public.hitter_stats_storage
  ADD COLUMN IF NOT EXISTS player_id uuid;

CREATE INDEX IF NOT EXISTS idx_hitter_stats_storage_player_id
  ON public.hitter_stats_storage (player_id)
  WHERE player_id IS NOT NULL;

ALTER TABLE public.hitting_power_ratings_storage
  ADD COLUMN IF NOT EXISTS player_id uuid;

CREATE INDEX IF NOT EXISTS idx_hitting_power_ratings_storage_player_id
  ON public.hitting_power_ratings_storage (player_id)
  WHERE player_id IS NOT NULL;
