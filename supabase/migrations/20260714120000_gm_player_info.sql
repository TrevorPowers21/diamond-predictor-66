-- GM player info: program-owned, editable player details that LAYER OVER the
-- shared (scraped) `players` record — so a program can add/correct DOB, contact,
-- jersey, eligibility, draft year, etc. without touching the base scouting row.
-- One row per (team, player). Recruiting-board data can be wired to upsert here
-- so every player added to the program carries this info. Read layering:
-- gm_player_info value  ??  players value  ??  derived default.

CREATE TABLE IF NOT EXISTS public.gm_player_info (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id      uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id             uuid NOT NULL,
  dob                   date,            -- birthday → drives age + the age-21 draft rule
  hometown              text,
  high_school           text,
  bats                  text,            -- L / R / S
  throws                text,            -- L / R
  height_inches         integer,
  weight_lbs            integer,
  jersey_number         text,            -- text: preserves leading zeros ("04")
  contact_phone         text,
  contact_email         text,
  eligibility_remaining integer,         -- NCAA years left (override; defaults from class)
  draft_eligible_year   integer,         -- editable; auto-defaults from class / DOB
  gpa                   numeric,         -- future academics
  academic_note         text,            -- future academics
  updated_by_user_id    uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, player_id)
);

-- Idempotent adds (the table may already exist from a prior run of this file).
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE public.gm_player_info ADD COLUMN IF NOT EXISTS contact_email text;

CREATE INDEX IF NOT EXISTS idx_gm_player_info_team_player ON public.gm_player_info (customer_team_id, player_id);

ALTER TABLE public.gm_player_info ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_player_info_all ON public.gm_player_info;
CREATE POLICY gm_player_info_all ON public.gm_player_info
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

NOTIFY pgrst, 'reload schema';
