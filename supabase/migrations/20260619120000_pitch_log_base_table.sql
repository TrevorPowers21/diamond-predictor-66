-- 2026-06-19 — Pitch Log base table
--
-- Per-pitch log ingested from TruMedia CSV exports. Multi-season via the
-- season column (no per-year tables). This migration creates ONLY the raw
-- CSV-mapped columns — computed flags (is_foul, is_in_play, is_strike,
-- etc.), reclassified pitch type, and Stuff+ per-pitch get added in a
-- follow-up migration after dry-run ingestion validates the base schema.
--
-- Sizing: expect 2M+ rows for 2026 alone. Indexes built for the dominant
-- access patterns (per-pitcher per-date, per-batter per-date,
-- pitch-type-grouped, date-range).
--
-- Per-CSV reading: ingestion script must use position-indexed CSV reading,
-- NOT name-indexed (DictReader). The TruMedia export has 4 silently
-- duplicate column names — pitchingTeam (cols 47 + 66), pitchingTeamId
-- (48 + 67), battingTeam (49 + 63), battingTeamId (50 + 64). We keep the
-- SECOND occurrence per the audit doc (Session 2 notes). Name-keyed
-- parsing silently keeps the second and drops the first; we want explicit
-- position control to be sure.
--
-- Empty cells → NULL, never zero (Session 2 brief).
--
-- See docs/PITCH_LOG_BUILD.md for full architecture, layer plan, and
-- locked rulings.

CREATE TABLE IF NOT EXISTS public.pitch_log (
  -- Primary key — TruMedia uniqPitchId (CSV col 7), encodes game+AB+pitch#
  uniq_pitch_id text PRIMARY KEY,

  -- Season for multi-year segmentation. Derived from date at ingest.
  season integer NOT NULL,

  -- Game context
  date timestamptz NOT NULL,                    -- CSV col 19 (date)
  game_venue_id text,                           -- CSV col 32 (gameVenueId)
  level text,                                   -- CSV col 33 (level, e.g. 'BBC')
  home boolean,                                 -- CSV col 38 (parsed from 'true'/'false')
  inn text,                                     -- CSV col 22 ('Top 1', 'Bot 3')
  outs integer,                                 -- CSV col 23

  -- Player IDs (CORE — must match players.source_player_id text values)
  pitcher_id text NOT NULL,                     -- CSV col 68 (pitcherId, second occurrence)
  batter_id text NOT NULL,                      -- CSV col 65 (batterId)
  catcher_id text,                              -- CSV col 71 (catcherId)

  -- Display names
  pitcher_full_name text,                       -- CSV col 9 (fullName)
  pitcher_abbrev_name text,                     -- CSV col 18 (pitcherAbbrevName)
  batter_abbrev_name text,                      -- CSV col 17 (batterAbbrevName)
  catcher_abbrev_name text,                     -- CSV col 72 (catcherAbbrevName)

  -- Handedness
  pitcher_hand char(1),                         -- CSV col 16
  batter_hand char(1),                          -- CSV col 14

  -- Team context (keep IDs only, drop name dupes)
  pitching_team_id text,                        -- CSV col 67 (second occurrence)
  batting_team_id text,                         -- CSV col 64 (second occurrence)
  catching_team_id text,                        -- CSV col 70
  team_id text,                                 -- CSV col 43
  opponent_id text,                             -- CSV col 44

  -- Outcome
  -- pitch_result allows NULL for rare edge cases (Catcher Interference
  -- with empty result string, etc.). Row still counts toward "pitches
  -- seen / thrown" denominators even without an outcome. Decided
  -- 2026-06-19 mid-build after first Feb13 ingestion surfaced 34 such rows.
  pitch_result text,                            -- CSV col 21 (CORE — parse for outcome category)
  count text,                                   -- CSV col 31 ('0-0', '1-2' etc.)

  -- Pitch classification (raw — reclassified version added in follow-up)
  pitch_type text,                              -- CSV col 24 (raw: FA/SL/CU/CH/FC/FS/SI/UN)

  -- Pitch metrics
  -- Bare numeric (no precision) — keeps every TruMedia value losslessly
  -- and rules out overflow on edge-case rows in the 100K rollup CSVs.
  release_velocity numeric,                     -- CSV col 74 (Vel)
  exit_velocity numeric,                        -- CSV col 81 (ExitVel) — NULL when not put in play
  launch_angle numeric,                         -- CSV col 82 (LaunchAng)
  cs_prob numeric,                              -- CSV col 29 (probSL) — called-strike probability 0–1
  ivb numeric,                                  -- CSV col 75 — induced vertical break
  hb numeric,                                   -- CSV col 76 — horizontal break
  extension numeric,                            -- CSV col 77
  spin numeric,                                 -- CSV col 78 (rpm)
  rel_height numeric,                           -- CSV col 79
  rel_side numeric,                             -- CSV col 80

  -- Location (plate-coord)
  x_loc numeric,                                -- CSV col 11
  y_loc numeric,                                -- CSV col 12

  -- Tracking-data presence flags. Three real tiers in TruMedia exports:
  --   1. Untracked — no velo, no movement (typical pitchType='UN' rows
  --      where Vel/IVB/HB all come in as '-' / NULL). Outcome was
  --      recorded but the tracking system missed the pitch entirely.
  --   2. Velo-only — velo present but IVB/HB missing. Usable for
  --      velocity-based filters (95+, avg velo) but NOT for movement
  --      metrics or Stuff+.
  --   3. Fully tracked — velo + IVB + HB present. Usable for everything
  --      including Stuff+.
  --
  -- We expose both presences as separate flags so downstream
  -- aggregations pick the right denominator per metric:
  --
  --   Metric class                  | Denominator
  --   ------------------------------|-----------------------
  --   Total pitches thrown / seen   | every row
  --   Strike %, ball %, outcome %   | every row
  --   Velo-based (95+ filter, avg)  | WHERE has_velo
  --   Stuff+, IVB/HB, Spin avgs     | WHERE is_data
  --   EV / Barrel / Hard Hit        | WHERE is_data AND is_batted_ball_in_play
  --
  -- Per-player data reliability % = COUNT(*) FILTER (WHERE is_data) / COUNT(*).
  -- Tracked over the full season so we know how reliable each player's
  -- sample is. Aggregations in Layer 2 / 3 will surface this.
  --
  -- Generated columns so they always reflect the underlying values —
  -- no manual sets, no drift if a row is updated.
  has_velo boolean GENERATED ALWAYS AS (
    release_velocity IS NOT NULL
  ) STORED,
  is_data boolean GENERATED ALWAYS AS (
    release_velocity IS NOT NULL
    AND ivb IS NOT NULL
    AND hb IS NOT NULL
  ) STORED,

  -- Score state (high-leverage / close-game filter source)
  total_runs integer,                           -- CSV col 41 (final)
  current_runs integer,                         -- CSV col 42 (at this pitch)
  opponent_current_runs integer,                -- CSV col 46
  opponent_runs integer,                        -- CSV col 45 (final)

  -- Audit
  imported_at timestamptz NOT NULL DEFAULT NOW(),
  csv_source text                               -- e.g., 'Feb13 Pitch Log.csv'
);

COMMENT ON TABLE public.pitch_log IS
  'Per-pitch raw log ingested from TruMedia CSV exports. Multi-season via season column. Layer 1 of the pitch log build (see docs/PITCH_LOG_BUILD.md). Computed flags + reclassified pitch type + Stuff+ added in follow-up migration. Expected size: 2M+ rows per season.';

-- Indexes for the dominant access patterns
CREATE INDEX IF NOT EXISTS idx_pitch_log_pitcher_date
  ON public.pitch_log(pitcher_id, date);
CREATE INDEX IF NOT EXISTS idx_pitch_log_batter_date
  ON public.pitch_log(batter_id, date);
CREATE INDEX IF NOT EXISTS idx_pitch_log_season_pitcher
  ON public.pitch_log(season, pitcher_id);
CREATE INDEX IF NOT EXISTS idx_pitch_log_season_batter
  ON public.pitch_log(season, batter_id);
CREATE INDEX IF NOT EXISTS idx_pitch_log_pitch_type
  ON public.pitch_log(pitch_type);
CREATE INDEX IF NOT EXISTS idx_pitch_log_date
  ON public.pitch_log(date);
