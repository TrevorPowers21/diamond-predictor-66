-- Two-way players (TWP) on the target board, mirroring the roster.
--
-- The roster (team_build_players) already stores a TWP as TWO rows — a hitter
-- slot + a pitcher slot, distinguished by position_slot, with no one-row-per-player
-- constraint. The target board did the opposite: UNIQUE (user_id, customer_team_id,
-- player_id) forced ONE merged row per player, so a TWP couldn't carry a separate
-- snapshot + recipe (production_notes) per side and couldn't map 1:1 to the roster.
--
-- This adds position_slot and swaps the uniqueness to include the side. One-way
-- players keep a single row (position_slot NULL → coalesce '' → still unique per
-- player). A TWP gets two rows with distinct slots. Gated on is_twp in the app, so
-- non-TWP behavior is unchanged.

ALTER TABLE public.target_board ADD COLUMN IF NOT EXISTS position_slot text;

-- Drop EVERY existing unique constraint on target_board (there are two from prior
-- scoping migrations: user_team_player and team_player) so none of them forces one
-- row per player. Then a single slot-aware unique index takes over.
DO $$
DECLARE cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.target_board'::regclass AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.target_board DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.target_board_user_team_player_slot_uidx;
CREATE UNIQUE INDEX target_board_user_team_player_slot_uidx
  ON public.target_board (user_id, customer_team_id, player_id, coalesce(position_slot, ''));

NOTIFY pgrst, 'reload schema';
