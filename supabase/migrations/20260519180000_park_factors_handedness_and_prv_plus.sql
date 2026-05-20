-- 2026-05-19 — Park factor handedness split + stored pRV+ on Pitching Master.
--
-- Park Factors:
--   Hitters now use handedness-split factors when projecting transfer outcomes.
--   LHB hitters apply LHB factors; RHB apply RHB; switch-hitters apply the
--   combined AVG/OBP/ISO. Returners do not apply any park factor at all.
--   Pitchers continue to use the combined rg/obp/iso factors (mapped to
--   ERA+FIP, WHIP, HR9 respectively; K9 and BB9 have no park factor).
--
-- Pitching Master:
--   p_rv_plus stored on each row = weighted composite of era_pr_plus,
--   fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus using
--   the weights in equation_weights. Used by team_war_snapshots and any
--   "last-year pRV+" surface. Mirrors the actual-stats-based wRC+ pattern
--   on the hitter side.

ALTER TABLE "Park Factors"
  ADD COLUMN IF NOT EXISTS lhb_avg_factor double precision,
  ADD COLUMN IF NOT EXISTS lhb_obp_factor double precision,
  ADD COLUMN IF NOT EXISTS lhb_iso_factor double precision,
  ADD COLUMN IF NOT EXISTS rhb_avg_factor double precision,
  ADD COLUMN IF NOT EXISTS rhb_obp_factor double precision,
  ADD COLUMN IF NOT EXISTS rhb_iso_factor double precision;

ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS p_rv_plus double precision;

COMMENT ON COLUMN "Park Factors".lhb_avg_factor IS 'AVG park factor vs left-handed batters (3yr).';
COMMENT ON COLUMN "Park Factors".lhb_obp_factor IS 'OBP park factor vs left-handed batters (3yr).';
COMMENT ON COLUMN "Park Factors".lhb_iso_factor IS 'ISO park factor vs left-handed batters (3yr).';
COMMENT ON COLUMN "Park Factors".rhb_avg_factor IS 'AVG park factor vs right-handed batters (3yr).';
COMMENT ON COLUMN "Park Factors".rhb_obp_factor IS 'OBP park factor vs right-handed batters (3yr).';
COMMENT ON COLUMN "Park Factors".rhb_iso_factor IS 'ISO park factor vs right-handed batters (3yr).';
COMMENT ON COLUMN "Pitching Master".p_rv_plus IS 'Actual-stats-based pRV+ for this season (weighted composite of era_pr_plus, fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus). Written by computeAndStorePitchingScores.';
