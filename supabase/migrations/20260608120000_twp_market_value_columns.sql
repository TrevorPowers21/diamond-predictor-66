-- Two-way player (TWP) market_value separation.
--
-- Before: TWP rows had a single `market_value` column that was overwritten
-- by whichever side (hitter or pitcher) ran last in the precompute or live
-- recalc. For Josiah Overbeek-style players (cornerstone hitter + bad RP),
-- the pitcher side wrote a near-zero market value on top of the hitter's
-- $60-80k, leaving him at $0-988 across all customer teams.
--
-- After: TWPs get two separate columns. Hitter context surfaces read
-- twp_hitter_market_value; pitcher context surfaces read twp_pitcher_market_value.
-- The base `market_value` column stays NULL on TWP rows so any unconverted
-- read path fails loud instead of showing a wrong number.
--
-- Non-TWP rows are unaffected — both new columns stay NULL and `market_value`
-- continues to be the single source of truth.

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS twp_hitter_market_value NUMERIC,
  ADD COLUMN IF NOT EXISTS twp_pitcher_market_value NUMERIC;

COMMENT ON COLUMN player_predictions.twp_hitter_market_value IS
  'TWP-only hitter-side market value. Populated when the player row is for is_twp=true. Non-TWP rows stay NULL.';

COMMENT ON COLUMN player_predictions.twp_pitcher_market_value IS
  'TWP-only pitcher-side market value. Populated when the player row is for is_twp=true. Non-TWP rows stay NULL.';
