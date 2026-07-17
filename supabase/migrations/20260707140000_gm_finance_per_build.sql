-- Front Office: re-key per-player finance to the BUILD row (build_player_id)
-- instead of (team, player, season). Makes GM money + roster metadata per-build
-- so scenario builds ("Carson stays" vs "Carson drafted") each carry their own
-- line, copy-on-write clones roster rows + finance together, and locally-added
-- players (freshmen/JUCO — no player_id, but they DO have a build_player_id) can
-- finally hold money. team_build_players is untouched; included_in_roster stays
-- the per-build membership.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS build_player_id  uuid REFERENCES public.team_build_players(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS roster_status    text,   -- 'leaving' etc. (mirrors production_notes.rosterStatus)
  ADD COLUMN IF NOT EXISTS departure_reason text;   -- 'draft' | 'graduation' | 'transfer' | 'other'

-- build_player_id is the identity now; player_id/season become optional metadata.
ALTER TABLE public.gm_player_finance ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE public.gm_player_finance ALTER COLUMN season   DROP NOT NULL;

-- Backfill existing season-level rows onto the team's DEFAULT build row for that
-- player (staging test data; per-build going forward).
UPDATE public.gm_player_finance f
SET build_player_id = tbp.id
FROM public.team_build_players tbp
JOIN public.team_builds tb ON tb.id = tbp.build_id
WHERE tbp.player_id = f.player_id
  AND tb.customer_team_id = f.customer_team_id
  AND tb.is_default = true
  AND f.build_player_id IS NULL;

-- Swap uniqueness: drop the season-level key (would reject the same player
-- appearing in two builds), add one finance row per roster row.
ALTER TABLE public.gm_player_finance DROP CONSTRAINT IF EXISTS gm_player_finance_customer_team_id_player_id_season_key;
CREATE UNIQUE INDEX IF NOT EXISTS gm_player_finance_build_player_id_key
  ON public.gm_player_finance (build_player_id);

-- Finalize Roster archives non-final builds instead of deleting them.
ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
