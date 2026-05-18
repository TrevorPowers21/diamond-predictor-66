-- Add dob + class_year columns to Hitter Master and Pitching Master.
--
-- Why: JUCO arms imported from Presto don't have class/DOB data, and the
-- existing D1 import pipeline doesn't carry these either. Adding the columns
-- now so the upcoming JUCO upload + 2026 D1 upload can land class/DOB into a
-- single canonical home alongside the rest of the per-season player record.
--
-- class_year stored as text (FR/SO/JR/SR/GR) to match the existing class_year
-- field on the players table. DOB as date.
--
-- This migration MUST run on staging first then prod (per schema-changes-run-twice
-- discipline). No backfill — existing rows stay NULL until the upload script runs.

ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS class_year text;

ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS dob date,
  ADD COLUMN IF NOT EXISTS class_year text;

-- Indexes on class_year for filter queries (Player Dashboard / Rankings).
CREATE INDEX IF NOT EXISTS idx_hitter_master_class_year
  ON "Hitter Master" (class_year)
  WHERE class_year IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pitching_master_class_year
  ON "Pitching Master" (class_year)
  WHERE class_year IS NOT NULL;
