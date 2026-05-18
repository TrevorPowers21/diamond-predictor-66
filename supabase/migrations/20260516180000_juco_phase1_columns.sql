-- ─── JUCO Phase 1 schema additions ──────────────────────────────────────────
-- Adds the columns needed to ingest JUCO data with full coverage:
--   * trackman_pitches — TruMedia exports a `P` count that reflects TrackMan
--     sample size only (not season totals). Needed for hitter quality-stat
--     pullback + pitcher Stuff+ sample sizing. Applies to BOTH divisions
--     (D1 retroactively benefits — see project_partial_scouting_gap memory).
--   * k_pct — strikeout rate per PA (hitters) / BF (pitchers). Currently not
--     stored on either master; JUCO needs it as a risk-assessment fallback
--     for players without TrackMan quality stats. Added to both for parity.
--   * bf — Batters Faced. JUCO export exposes it; D1 doesn't currently.
--     Useful as a clean workload proxy and K%/BB% denominator.
--   * district + region — Teams Table columns for JUCO's geographic taxonomy.
--     District drives baseline math (10 districts cover 19 regions). Region
--     stays as identity/display. Both NULL for D1 rows.
--
-- All adds are idempotent (IF NOT EXISTS). Staging-discipline rule applies:
-- run on staging first (slrxowawbijbjrkozqlj), verify, then prod
-- (trbvxuoliwrfowibatkm). See feedback_csv_staging_branch_discipline memory.

-- ─── Hitter Master ────────────────────────────────────────────────────────
ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS trackman_pitches INTEGER NULL,
  ADD COLUMN IF NOT EXISTS k_pct NUMERIC NULL;

-- ─── Pitching Master ──────────────────────────────────────────────────────
ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS trackman_pitches INTEGER NULL,
  ADD COLUMN IF NOT EXISTS k_pct NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS bf INTEGER NULL;

-- ─── Teams Table ──────────────────────────────────────────────────────────
-- JUCO district + region. Region for display ("NJCAA D1 Region 14"), district
-- for math (groups 19 regions into 10 NJCAA-official competitive groupings).
-- See project_juco_exploration_branch memory for the region→district map.
ALTER TABLE "Teams Table"
  ADD COLUMN IF NOT EXISTS region TEXT NULL,
  ADD COLUMN IF NOT EXISTS district TEXT NULL;

-- Indexes for the columns that drive baseline lookups + filtered reads.
CREATE INDEX IF NOT EXISTS idx_teams_table_district ON "Teams Table" (district);
CREATE INDEX IF NOT EXISTS idx_teams_table_region ON "Teams Table" (region);
