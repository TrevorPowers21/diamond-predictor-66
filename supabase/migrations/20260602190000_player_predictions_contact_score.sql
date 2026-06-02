-- Add contact_score to player_predictions + propagation function for all 4
-- hitter scouting scores (contact, barrel, ev, chase) so values stay 1=1 with
-- Hitter Master after computeAndStoreScores runs.
--
-- Why: today the dashboard fetches all of Hitter Master to derive these
-- display values per row. With the propagation function, computeAndStoreScores
-- writes the scores to Hitter Master AND to predictions in one trigger, and
-- the dashboard reads them straight from the prediction row. No fuzzy match,
-- no 16K-row seed fetch needed for the score display.
--
-- Equations (baPower / obpPower) are unaffected. This is display propagation
-- only — same numbers, two homes.

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS contact_score numeric;

COMMENT ON COLUMN player_predictions.contact_score IS
  'Percentile-normalized contact-rate score. Copy of Hitter Master.contact_score for the player''s source season. Display-only; ba_power / obp_power equations are unaffected.';

-- Hitter propagation function: after computeAndStoreScores writes scores to
-- Hitter Master, this copies all 4 scouting scores to every player_predictions
-- row (regular + every team-scoped precomputed variant) for the matching player.
CREATE OR REPLACE FUNCTION propagate_hitter_scores_to_predictions(target_season int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE player_predictions pp
  SET
    contact_score = hm.contact_score,
    barrel_score  = hm.barrel_score,
    ev_score      = hm.avg_ev_score,
    chase_score   = hm.chase_score
  FROM players p, "Hitter Master" hm
  WHERE pp.player_id = p.id
    AND hm.source_player_id = p.source_player_id
    AND hm."Season" = target_season
    AND (
      hm.contact_score IS NOT NULL
      OR hm.barrel_score IS NOT NULL
      OR hm.avg_ev_score IS NOT NULL
      OR hm.chase_score IS NOT NULL
    );
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

-- Add iz_whiff_score to player_predictions (mirrors Pitching Master.iz_whiff_score).
-- Other pitcher scores (whiff_score, barrel_score, chase_score, ev_score) already
-- exist as columns on player_predictions.
ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS iz_whiff_score numeric;

COMMENT ON COLUMN player_predictions.iz_whiff_score IS
  'In-zone whiff percentile score. Copy of Pitching Master.iz_whiff_score. Display-only; equations unaffected.';

-- Pitcher propagation function: after computeAndStoreScores writes scores to
-- Pitching Master, this copies all 5 pitcher scouting scores to every
-- player_predictions row for the matching player.
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
    ev_score       = pm.ev_score
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
    );
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;
