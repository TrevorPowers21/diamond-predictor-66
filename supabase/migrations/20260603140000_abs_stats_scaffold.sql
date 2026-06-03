-- ABS (Automated Ball-Strike) stats scaffolding.
--
-- Background: ABS is coming to the SEC. Georgia wants to see how their
-- target players' plate-discipline + contact stats look under the new
-- (larger) ABS strike zone compared to the current NCAA zone.
--
-- Trevor recomputes each player's stats with the expanded zone offline,
-- then uploads a CSV. This migration scaffolds the destination tables.
--
-- Scope: D1 ONLY. NJCAA_D1 (JUCO) players intentionally never get rows
-- here — they're not playing in the SEC and the ABS comparison doesn't
-- apply. The display component hides itself when no rows exist.
--
-- Columns are paired (current-zone vs ABS-zone) so a single SELECT
-- powers the comparison table — no join to Hitter Master / Pitching
-- Master required for the display. Trevor's CSV writes both values
-- per stat.
--
-- Tables stay empty until Trevor uploads the CSV; the UI hides itself
-- in that state.

CREATE TABLE IF NOT EXISTS abs_hitter_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player_id text NOT NULL,
  season int NOT NULL,

  -- Plate discipline (current zone)
  chase_pct numeric,
  csw_pct numeric,
  contact_pct numeric,
  in_zone_contact_pct numeric,

  -- Plate discipline (ABS zone)
  abs_chase_pct numeric,
  abs_csw_pct numeric,
  abs_contact_pct numeric,
  abs_in_zone_contact_pct numeric,

  -- Contact quality (current zone)
  avg_exit_velo numeric,
  ev_in_zone numeric,
  ev_outskirts numeric,
  barrel_pct numeric,

  -- Contact quality (ABS zone)
  abs_avg_exit_velo numeric,
  abs_ev_in_zone numeric,
  abs_ev_outskirts numeric,
  abs_barrel_pct numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_abs_hitter_stats_lookup
  ON abs_hitter_stats (source_player_id, season);

COMMENT ON TABLE abs_hitter_stats IS
  'Hitter stats recomputed under the SEC ABS (Automated Ball-Strike) zone alongside current-zone values. D1 only — JUCO players never get rows here. Display gated to Georgia customer team.';

CREATE TABLE IF NOT EXISTS abs_pitcher_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player_id text NOT NULL,
  season int NOT NULL,

  -- Current zone
  csw_pct numeric,
  strike_pct numeric,
  in_zone_pct numeric,

  -- ABS zone
  abs_csw_pct numeric,
  abs_strike_pct numeric,
  abs_in_zone_pct numeric,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_abs_pitcher_stats_lookup
  ON abs_pitcher_stats (source_player_id, season);

COMMENT ON TABLE abs_pitcher_stats IS
  'Pitcher stats recomputed under the SEC ABS (Automated Ball-Strike) zone alongside current-zone values. D1 only — JUCO players never get rows here. Display gated to Georgia customer team.';
