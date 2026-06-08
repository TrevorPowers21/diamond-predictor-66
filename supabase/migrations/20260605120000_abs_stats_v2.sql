-- ABS (Automated Ball-Strike) stats scaffolding — V2.
--
-- Background: ABS is coming to the SEC. Georgia wants to see how their
-- target players' plate-discipline + contact stats look under the new
-- ABS strike zone compared to the current NCAA zone.
--
-- This schema matches the TruMedia ABS export. Each TruMedia metric is
-- stored as a paired column (current zone + ABS zone) so a single SELECT
-- powers the comparison table with no joins.
--
-- Scope: D1 ONLY. NJCAA_D1 (JUCO) players intentionally never get rows
-- here — the SEC ABS comparison doesn't apply. The importer filters
-- on newestTeamLevel from the CSV; the display component additionally
-- hides itself when no rows exist.
--
-- Display gated to Georgia customer team in the UI.
--
-- This migration supersedes the unshipped scaffold at
-- 20260603140000_abs_stats_scaffold.sql (never deployed). Tables are
-- created fresh — if the old tables somehow exist, they get dropped
-- so the column shapes match the actual TruMedia data.

DROP TABLE IF EXISTS abs_hitter_stats;
DROP TABLE IF EXISTS abs_pitcher_stats;

-- ─── Hitter table ───────────────────────────────────────────────────
--
-- TruMedia hitter ABS export columns map as:
--   IzBarrel%          → iz_barrel_pct
--   HABSizBarrel%      → abs_iz_barrel_pct
--   InZoneSwing%       → iz_swing_pct
--   HABS InZoneSwing%  → abs_iz_swing_pct
--   IzExitVel          → iz_exit_velo
--   HABSizEV           → abs_iz_exit_velo
--   InZoneWhiff%       → iz_whiff_pct
--   HABSInZoneWhiff%   → abs_iz_whiff_pct
--   Chase%             → chase_pct  (no ABS counterpart in this export)

CREATE TABLE abs_hitter_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player_id text NOT NULL,
  season int NOT NULL,

  -- In-zone barrel %
  iz_barrel_pct numeric,
  abs_iz_barrel_pct numeric,

  -- In-zone swing %
  iz_swing_pct numeric,
  abs_iz_swing_pct numeric,

  -- In-zone exit velocity
  iz_exit_velo numeric,
  abs_iz_exit_velo numeric,

  -- In-zone whiff %
  iz_whiff_pct numeric,
  abs_iz_whiff_pct numeric,

  -- Chase % — paired (HABSChase% added to TruMedia export 2026-06-05)
  chase_pct numeric,
  abs_chase_pct numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_player_id, season)
);

CREATE INDEX idx_abs_hitter_stats_lookup
  ON abs_hitter_stats (source_player_id, season);

COMMENT ON TABLE abs_hitter_stats IS
  'Hitter stats recomputed under the SEC ABS (Automated Ball-Strike) zone alongside current-zone values. Sourced from TruMedia ABS export. D1 only — JUCO players never get rows here. Display gated to Georgia customer team.';

-- ─── Pitcher table ──────────────────────────────────────────────────
--
-- TruMedia pitcher ABS export columns map as:
--   Chase%            → chase_pct
--   ABSChase          → abs_chase_pct
--                       (the ABSChase column is the ABS chase % rate;
--                        the separate ABSChase% column is unpopulated
--                        in the export and is skipped at import time)
--   InZoneWhiff%      → iz_whiff_pct
--   ABSInZoneWhiff%   → abs_iz_whiff_pct
--   CSW%              → csw_pct
--   ABSCSW%           → abs_csw_pct
--   Strike%           → strike_pct
--   ABSStrike%        → abs_strike_pct
--   InZoneMdl%        → iz_pct
--   ABSInZone%        → abs_iz_pct

CREATE TABLE abs_pitcher_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player_id text NOT NULL,
  season int NOT NULL,

  -- Chase %
  chase_pct numeric,
  abs_chase_pct numeric,

  -- In-zone whiff %
  iz_whiff_pct numeric,
  abs_iz_whiff_pct numeric,

  -- CSW % (Called-Strike + Whiff rate)
  csw_pct numeric,
  abs_csw_pct numeric,

  -- Strike %
  strike_pct numeric,
  abs_strike_pct numeric,

  -- In-zone %
  iz_pct numeric,
  abs_iz_pct numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_player_id, season)
);

CREATE INDEX idx_abs_pitcher_stats_lookup
  ON abs_pitcher_stats (source_player_id, season);

COMMENT ON TABLE abs_pitcher_stats IS
  'Pitcher stats recomputed under the SEC ABS (Automated Ball-Strike) zone alongside current-zone values. Sourced from TruMedia ABS export. D1 only — JUCO players never get rows here. Display gated to Georgia customer team.';

-- Row-level security. Anyone authenticated can SELECT — the Georgia gate
-- is enforced client-side in ABSComparisonTable.tsx via schoolTeamId, so
-- DB-level row filtering isn't needed. RLS is on so the tables aren't
-- world-readable; the simple "true" policy just lets logged-in coaches
-- read the rows their UI is allowed to display.
ALTER TABLE abs_hitter_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE abs_pitcher_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abs_hitter_stats_read_authenticated"
  ON abs_hitter_stats FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "abs_pitcher_stats_read_authenticated"
  ON abs_pitcher_stats FOR SELECT
  TO authenticated
  USING (true);
