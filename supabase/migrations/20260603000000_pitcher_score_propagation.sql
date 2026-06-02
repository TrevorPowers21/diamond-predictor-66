-- Pitcher score 1=1 propagation: storage layer + bb_score column on predictions.
--
-- Mirrors the hitter pattern (see 20260602190000_player_predictions_contact_score.sql):
-- computeAndStorePitchingScores writes scores to Pitching Master + propagates
-- to player_predictions so display reads from a single source.
--
-- This PR's display switches Whf/BB/Brl tiles to read from predictions
-- (after the bb_score backfill below). Stuff+ tile stays client-computed
-- until the next computeAndStoreScores run populates stuff_score — at which
-- point a follow-up PR can switch the Stuff+ display source.
--
-- Equations untouched. Storage layer only.

-- 1. Add bb_score (already-stored Pitching Master value) to predictions.
ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS bb_score numeric;

COMMENT ON COLUMN player_predictions.bb_score IS
  'Pitcher walk-rate percentile score. Copy of Pitching Master.bb_score. Display-only; equations unaffected.';

-- 2. Add stuff_score columns (future-ready). Currently null everywhere — will
-- be populated by the next computeAndStorePitchingScores run, then propagated
-- to predictions via the function below.
ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS stuff_score numeric;

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS stuff_score numeric;

COMMENT ON COLUMN "Pitching Master".stuff_score IS
  'Percentile-normalized Stuff+ score. Computed by computeAndStorePitchingScores from stuff_plus + NCAA baseline. Today: null until next compute run. Then 1=1 with the displayed Stf+ tile.';

COMMENT ON COLUMN player_predictions.stuff_score IS
  'Mirror of Pitching Master.stuff_score, propagated by propagate_pitcher_scores_to_predictions().';

-- 3. Extend propagation function to include bb_score + stuff_score.
CREATE OR REPLACE FUNCTION propagate_pitcher_scores_to_predictions(target_season int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE player_predictions pp
  SET
    whiff_score    = pm.whiff_score,
    iz_whiff_score = pm.iz_whiff_score,
    barrel_score   = pm.barrel_score,
    chase_score    = pm.chase_score,
    ev_score       = pm.ev_score,
    bb_score       = pm.bb_score,
    stuff_score    = pm.stuff_score
  FROM players p, "Pitching Master" pm
  WHERE pp.player_id = p.id
    AND pm.source_player_id = p.source_player_id
    AND pm."Season" = target_season
    AND (
      pm.whiff_score IS NOT NULL
      OR pm.iz_whiff_score IS NOT NULL
      OR pm.barrel_score IS NOT NULL
      OR pm.chase_score IS NOT NULL
      OR pm.ev_score IS NOT NULL
      OR pm.bb_score IS NOT NULL
      OR pm.stuff_score IS NOT NULL
    );
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

-- 4. One-time backfill: copy bb_score from Pitching Master to predictions.
-- stuff_score deliberately NOT backfilled — it's null on Pitching Master today
-- and will populate on next compute run.
UPDATE player_predictions pp
SET bb_score = pm.bb_score
FROM players p, "Pitching Master" pm
WHERE pp.player_id = p.id
  AND pm.source_player_id = p.source_player_id
  AND pm."Season" = 2026
  AND pm.bb_score IS NOT NULL;
