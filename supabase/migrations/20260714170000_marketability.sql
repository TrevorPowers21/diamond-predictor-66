-- Marketability scoring inputs.
-- (1) Per-player: social handles (stored alongside the follower counts) and a
--     university-connection tier + note (legacy/alumni ties — manual "icing").
-- (2) Per-program: a hand-set community tier (1-5) capturing fanbase/community
--     pull (Arkansas high, small-following programs low). Team-scoped; one row
--     per customer program for now — extends to per-opponent-school later.

ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS instagram_handle text;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS twitter_handle   text;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS tiktok_handle    text;
-- 'family_notable' | 'family_alum' | 'local' | null
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS university_connection_tier text;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS university_connection_note text;

CREATE TABLE IF NOT EXISTS public.gm_program_marketability (
  customer_team_id uuid PRIMARY KEY REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  community_tier   integer,          -- 1 (minimal) .. 5 (elite); null = neutral default
  note             text,
  updated_by_user_id uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gm_program_marketability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_program_marketability_all ON public.gm_program_marketability;
CREATE POLICY gm_program_marketability_all ON public.gm_program_marketability
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

NOTIFY pgrst, 'reload schema';
