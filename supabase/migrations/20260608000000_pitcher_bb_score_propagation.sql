-- Restore bb_score propagation for pitchers.
--
-- The 06-03 split-scouting-scores migration accidentally dropped bb_score
-- from the pitcher propagation function (the SET clause stopped writing
-- both pitcher_bb_score and legacy bb_score for pitcher-domain rows).
-- The dashboard's pitcher scouting grade cell silently gated on bb_score
-- being non-null among the 4 grades, so the entire scouting tile was
-- showing "—" for every pitcher after the split.
--
-- Fix: re-add pitcher_bb_score + legacy bb_score to the SET clause. Match
-- the structure of the other pitcher_*_score columns. NO collision risk
-- with hitter_bb_score (separate column), so legacy bb_score on a row
-- that's pitcher-only stays correct.

CREATE OR REPLACE FUNCTION propagate_pitcher_scores_to_predictions(target_season int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE player_predictions pp
  SET
    pitcher_whiff_score    = pm.whiff_score,
    pitcher_iz_whiff_score = pm.iz_whiff_score,
    pitcher_barrel_score   = pm.barrel_score,
    pitcher_chase_score    = pm.chase_score,
    pitcher_ev_score       = pm.ev_score,
    pitcher_bb_score       = pm.bb_score,
    -- Legacy pitcher-domain columns stay populated for back-compat.
    whiff_score    = pm.whiff_score,
    iz_whiff_score = pm.iz_whiff_score,
    bb_score       = pm.bb_score,
    stuff_score    = pm.stuff_score
    -- Intentionally NOT touching legacy chase_score / barrel_score /
    -- ev_score here. Those columns are now hitter-domain only.
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
