-- ─── pitcher_stuff_plus_inputs gets division column ─────────────────────
-- The original JUCO scaffold migration missed this table. Without it, the
-- reclassifier's pop computation pulls D1 + JUCO rows into one pool,
-- contaminating the baseline D1 pop constants. Adding division here lets
-- the reclassifier filter to D1 for population stats.
--
-- After the column exists, backfill JUCO rows that were already inserted
-- by the JUCO importer (it wrote them with the implicit DEFAULT 'D1' since
-- the column didn't exist when the data landed). Use the players table as
-- the source of truth for which source_player_ids are JUCO.

ALTER TABLE pitcher_stuff_plus_inputs
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

CREATE INDEX IF NOT EXISTS idx_pitcher_stuff_plus_inputs_division
  ON pitcher_stuff_plus_inputs (division);

-- Backfill JUCO rows. Idempotent — re-runs don't double-flip rows.
UPDATE pitcher_stuff_plus_inputs spi
SET division = 'NJCAA_D1'
WHERE division = 'D1'
  AND source_player_id IN (
    SELECT source_player_id FROM players WHERE division = 'NJCAA_D1'
  );
