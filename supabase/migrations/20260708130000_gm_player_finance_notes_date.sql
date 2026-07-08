-- Timestamp of when a player's GM note was last written — shown next to the
-- note. Separate from the row's generic updated_at (which changes on any
-- finance edit) so it reflects the NOTE's date specifically.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS notes_updated_at timestamptz;
