-- Persist the NEUTRAL projection (the immutable dev_agg=0 line) on each build player
-- and target-board row, so the toggle recompute always has its base without depending
-- on a live prediction fetch. The load used to skip fetching the neutral for rows that
-- already had a snapshot, so a player saved with a non-zero dev-agg had a null neutral
-- and compounded on every toggle (Flukey). Storing it removes that whole failure class.
--
-- One-way player → one row, own line. TWP → two rows (hitter slot + pitcher slot), each
-- carrying its own side's neutral. Stamped at add/save; backfilled for existing rows.

ALTER TABLE public.team_build_players ADD COLUMN IF NOT EXISTS neutral_snapshot jsonb;
ALTER TABLE public.target_board        ADD COLUMN IF NOT EXISTS neutral_snapshot jsonb;

NOTIFY pgrst, 'reload schema';
