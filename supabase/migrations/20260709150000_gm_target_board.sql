-- GM Target Board: the front office's view of the team's shared recruiting
-- watchlist (the same universal target_board the coaches use), plus two
-- GM-only overlays keyed by (customer_team_id, player_id):
--   * gm_target_offer  — the single "what we're willing to pay" number per target
--   * gm_target_notes  — an authored/dated note LOG per target (mirrors
--                        gm_player_notes, but keyed by player rather than build row
--                        since a target isn't on any build yet)
-- Both team-scoped and shared across the staff, same RLS wall as every GM table.

CREATE TABLE IF NOT EXISTS public.gm_target_offer (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id          uuid NOT NULL,
  offer_amount       numeric,                          -- what we're willing to pay
  updated_by_user_id uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, player_id)
);

ALTER TABLE public.gm_target_offer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_target_offer_all ON public.gm_target_offer;
CREATE POLICY gm_target_offer_all ON public.gm_target_offer
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

CREATE TABLE IF NOT EXISTS public.gm_target_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id          uuid NOT NULL,
  author             text,                             -- who wrote it (email/name snapshot)
  note_date          date NOT NULL DEFAULT current_date,
  body               text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_target_notes_team_player ON public.gm_target_notes (customer_team_id, player_id);

ALTER TABLE public.gm_target_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_target_notes_all ON public.gm_target_notes;
CREATE POLICY gm_target_notes_all ON public.gm_target_notes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

NOTIFY pgrst, 'reload schema';
