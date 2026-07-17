-- Social-media following on gm_player_info: per-platform follower counts a
-- program can enter for a player. Total is derived (sum) in the UI, not stored.
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS instagram_followers integer;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS twitter_followers   integer;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS tiktok_followers    integer;

NOTIFY pgrst, 'reload schema';
