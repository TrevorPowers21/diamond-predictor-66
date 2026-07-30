-- Link each recruiting-board row to its canonical (global) RSTR IQ identity in
-- players. The identity is minted / looked-up via resolve_or_create_prospect() at
-- add time (useGmRecruits.addRecruit). This nullable FK records which players.id a
-- recruit resolved to — so a recruit tracked TODAY deterministically links to their
-- college data LATER (via the shared PBR/PG key already in player_external_ids),
-- instead of a fuzzy name-match backfill after the fact.
--
-- gm_recruits stays program-private (RLS by customer_team_id); only the players
-- identity it points to is global + shared. ON DELETE SET NULL so removing an
-- identity never deletes a program's private recruit tracking.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES public.players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gm_recruits_player_id ON public.gm_recruits (player_id);
