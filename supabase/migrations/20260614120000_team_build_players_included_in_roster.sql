-- Add `included_in_roster` flag to team_build_players so the Team Builder
-- target board can act as a "shopping list" — every target row persists
-- regardless of whether the coach is actually counting them toward the
-- roster, and a toggle on the row controls whether they aggregate into
-- the roster totals (oWAR sum, market value sum, NIL budget, etc.).
--
-- NOT NULL DEFAULT true is intentional:
--   * Every existing row (returner OR target) is currently counted as on
--     roster, so the default preserves today's behavior 1:1 with no
--     backfill needed.
--   * Returner rows are conceptually always on-roster — the column
--     applies uniformly but only the add-from-search path will ever set
--     it to false for newly added targets.
--
-- The frontend reads this column on load, persists it on save, and
-- filters off-roster targets out of roster aggregations. Marginal next-
-- add value for off-roster targets is computed in the React layer
-- (denominator = returners + on-roster targets + this target, excluding
-- other off-roster targets).

ALTER TABLE team_build_players
  ADD COLUMN included_in_roster boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN team_build_players.included_in_roster IS
  'Whether this row counts toward roster aggregations (oWAR sum, MV sum, NIL budget). Defaults true for returners; new search-added targets land as false until the coach clicks the "+" toggle on the target board.';

-- Backfill: every existing target row (saved before the shopping-list
-- model existed) was implicitly "on roster" and has been inflating the
-- coach's Total WAR / NIL / budget / Program Analytics / depth chart.
-- Flip them to off-roster ("+") so saved builds show the corrected math
-- the moment they reload. Coaches re-confirm any targets they actually
-- want on roster by clicking the "+" → "✓" toggle. No rows deleted, no
-- depth assignments broken, target_board_picks untouched, returner rows
-- untouched (only source='portal' is updated).
UPDATE team_build_players
   SET included_in_roster = false
 WHERE source = 'portal';
