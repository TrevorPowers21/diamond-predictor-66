-- Add Pull Air% columns to Hitter Master.
-- pull_air = raw % (0-100) of pulled balls in the air. Critical translator
-- of avg EV → game power (low-EV hitters with high pull air still produce).
-- pull_air_score = percentile rank (0-100) within the imported population.
--
-- Display-only for now. Not wired into any equations.

ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS pull_air        numeric,
  ADD COLUMN IF NOT EXISTS pull_air_score  numeric;

COMMENT ON COLUMN "Hitter Master".pull_air       IS 'Raw Pull Air % (0-100). Pulled balls in the air rate. Display only.';
COMMENT ON COLUMN "Hitter Master".pull_air_score IS 'Percentile rank (0-100) of pull_air within imported NCAA D1 cohort.';
