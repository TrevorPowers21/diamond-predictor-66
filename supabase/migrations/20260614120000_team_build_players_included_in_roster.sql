-- Add `included_in_roster` flag to team_build_players so the Team Builder
-- target board can act as a "shopping list" — every target row persists
-- regardless of whether the coach is actually counting them toward the
-- roster, and a toggle on the row controls whether they aggregate into
-- the roster totals (oWAR sum, market value sum, NIL budget, etc.).
--
-- NOT NULL DEFAULT true is intentional:
--   * Every existing returner row stays counted (no behavior change for
--     real roster members).
--   * Newly added targets via search land as false (off-roster) and
--     flip to true when the coach clicks the "+" toggle.

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
