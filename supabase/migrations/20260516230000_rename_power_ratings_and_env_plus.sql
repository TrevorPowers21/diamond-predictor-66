-- Column rename refactor for engine clarity (2026-05-16).
--
-- Problem: same column NAMES (ba_plus, obp_plus, iso_plus) existed on TWO
-- tables with DIFFERENT semantic meanings, creating runtime foot-gun risk:
--   - Hitter Master.ba_plus = POWER RATING (sub-metric derived from contact/EV/etc.)
--   - Conference Stats.ba_plus = ENV+ stat (conf rate / NCAA rate × 100)
--
-- Fix:
--   1. Rename Hitter Master columns to *_power_rating suffix (honest)
--   2. Rename Conference Stats.ba_plus → avg_plus (matches AVG column convention)
--   3. Add slg_plus to Conference Stats (new column, doesn't exist yet)
--
-- Engine clarity outcome:
--   - Every *_power_rating reference = unambiguous power rating on Hitter Master
--   - Every *_plus reference = unambiguous env+ stat on Conference Stats
--   - No more name collision between tables

-- ── Hitter Master: rename power ratings (4 columns) ───────────────────
ALTER TABLE "Hitter Master" RENAME COLUMN ba_plus TO ba_power_rating;
ALTER TABLE "Hitter Master" RENAME COLUMN obp_plus TO obp_power_rating;
ALTER TABLE "Hitter Master" RENAME COLUMN iso_plus TO iso_power_rating;
ALTER TABLE "Hitter Master" RENAME COLUMN overall_plus TO overall_power_rating;

-- ── Conference Stats: add new slg_plus column (additive only) ─────────
-- Note: Conference Stats columns kept as ba_plus / obp_plus / iso_plus —
-- those match TruMedia source naming (BA) + standard sabermetric convention
-- (BA+). Only Hitter Master needed renaming because there the power-rating
-- columns were misnamed with _plus suffix.
ALTER TABLE "Conference Stats" ADD COLUMN IF NOT EXISTS slg_plus numeric NULL;
