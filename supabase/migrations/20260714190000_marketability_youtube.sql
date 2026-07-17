-- YouTube added to the social-following platforms on gm_player_info.
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS youtube_followers integer;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS youtube_handle    text;

NOTIFY pgrst, 'reload schema';
