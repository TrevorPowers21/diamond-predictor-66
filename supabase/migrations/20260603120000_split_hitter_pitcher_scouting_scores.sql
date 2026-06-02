-- Split hitter vs pitcher scouting scores on player_predictions.
--
-- Background: today the scouting score columns on player_predictions
-- (contact_score, barrel_score, chase_score, ev_score, whiff_score,
-- iz_whiff_score, bb_score) are written by BOTH the hitter and pitcher
-- propagation functions. A two-way player (e.g. a position player who
-- throws 1 inning of mop-up) has the second-running propagation stomp
-- the first. Bingaman: chase_score went from 62.5 (hitter percentile)
-- to 0.04 (pitcher percentile from a 1-IP sample) because the pitcher
-- function ran after the hitter function.
--
-- Fix: split into hitter_*_score and pitcher_*_score so the two domains
-- never collide. Each propagation function writes to its own columns.
-- Hitter dashboard / PlayerProfile reads hitter_*; pitcher dashboard /
-- PitcherProfile reads pitcher_*. True two-way players see correct
-- values on both sides.
--
-- Legacy ambiguous columns stay in place and are populated for backward
-- compat until all read paths switch over. Drop them in a follow-up
-- migration once nothing reads them.

ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS hitter_contact_score numeric,
  ADD COLUMN IF NOT EXISTS hitter_barrel_score  numeric,
  ADD COLUMN IF NOT EXISTS hitter_chase_score   numeric,
  ADD COLUMN IF NOT EXISTS hitter_ev_score      numeric,
  ADD COLUMN IF NOT EXISTS pitcher_whiff_score    numeric,
  ADD COLUMN IF NOT EXISTS pitcher_iz_whiff_score numeric,
  ADD COLUMN IF NOT EXISTS pitcher_barrel_score   numeric,
  ADD COLUMN IF NOT EXISTS pitcher_chase_score    numeric,
  ADD COLUMN IF NOT EXISTS pitcher_ev_score       numeric,
  ADD COLUMN IF NOT EXISTS pitcher_bb_score       numeric;

COMMENT ON COLUMN player_predictions.hitter_contact_score IS 'Hitter contact percentile from Hitter Master. Domain-scoped — never overwritten by pitcher propagation.';
COMMENT ON COLUMN player_predictions.hitter_barrel_score  IS 'Hitter barrel% percentile from Hitter Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.hitter_chase_score   IS 'Hitter chase% percentile from Hitter Master (lower-is-better, inverted). Domain-scoped.';
COMMENT ON COLUMN player_predictions.hitter_ev_score      IS 'Hitter avg exit velo percentile from Hitter Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_whiff_score    IS 'Pitcher whiff% percentile from Pitching Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_iz_whiff_score IS 'Pitcher in-zone whiff% percentile from Pitching Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_barrel_score   IS 'Pitcher barrel% percentile (against) from Pitching Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_chase_score    IS 'Pitcher chase% percentile (induced) from Pitching Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_ev_score       IS 'Pitcher avg exit velo against percentile from Pitching Master. Domain-scoped.';
COMMENT ON COLUMN player_predictions.pitcher_bb_score       IS 'Pitcher BB% percentile (inverted) from Pitching Master. Domain-scoped.';

-- Replace hitter propagation function to write to hitter_* columns.
-- Also keeps the legacy columns populated until read paths switch over.
CREATE OR REPLACE FUNCTION propagate_hitter_scores_to_predictions(target_season int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  rows_updated int;
BEGIN
  UPDATE player_predictions pp
  SET
    hitter_contact_score = hm.contact_score,
    hitter_barrel_score  = hm.barrel_score,
    hitter_chase_score   = hm.chase_score,
    hitter_ev_score      = hm.avg_ev_score,
    -- Keep legacy columns in sync for callers that haven't migrated yet.
    -- New code reads from hitter_* columns directly.
    contact_score = hm.contact_score,
    barrel_score  = hm.barrel_score,
    chase_score   = hm.chase_score,
    ev_score      = hm.avg_ev_score
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

-- Replace pitcher propagation function to write to pitcher_* columns.
-- NO LONGER writes to legacy chase_score, barrel_score, ev_score — those
-- now belong to hitter scoring exclusively. whiff_score, iz_whiff_score,
-- bb_score continue to populate legacy columns since they have no hitter
-- counterpart that would collide.
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
    -- Legacy pitcher-domain columns stay populated for back-compat.
    whiff_score    = pm.whiff_score,
    iz_whiff_score = pm.iz_whiff_score
    -- Intentionally NOT touching legacy chase_score / barrel_score /
    -- ev_score / bb_score here. Those columns are now hitter-domain
    -- only (per the new propagation). Two-way players keep their
    -- hitter values intact regardless of run order.
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
