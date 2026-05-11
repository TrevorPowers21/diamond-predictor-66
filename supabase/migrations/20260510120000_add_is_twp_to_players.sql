-- Add is_twp boolean flag to players for the real two-way player architecture.
--
-- Replaces the prior "position = 'TWP'" overload, which destroyed the underlying
-- hitter Pos (so a TWP-SS could not be filtered as SS in the hitter dashboard).
--
-- Under the new architecture:
--   * players.position holds the player's PRIMARY side (hitter Pos for
--     hitter-primary TWPs, 'P' for pitcher-primary TWPs).
--   * players.is_twp = true marks the player as a two-way player.
--
-- A TWP appears in BOTH the hitter and pitcher dashboards, and the Team
-- Builder seeds the same source_player_id into both pools (one slot each side).
-- The display pattern is "<primary_pos> · TWP" — primary dominant, TWP muted.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_twp boolean NOT NULL DEFAULT false;

-- Index so the dashboard filter pill and Team Builder pitcher-pool predicate
-- can quickly scan for TWPs.
CREATE INDEX IF NOT EXISTS idx_players_is_twp ON players (is_twp) WHERE is_twp = true;

COMMENT ON COLUMN players.is_twp IS
  'Two-way player flag. When true, the player has both meaningful hitting AND pitching activity (default thresholds: PA >= 30 AND IP >= 5). Set by recomputeTwpStatus(). position still holds the primary side (hitter Pos for hitter-primary, ''P'' for pitcher-primary).';
