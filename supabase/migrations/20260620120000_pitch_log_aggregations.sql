-- 2026-06-20 — Pitch Log Layer 2/3 aggregations
--
-- Three computed tables that roll up pitch_log into per-player season
-- aggregates. All metrics stored as COUNTS (not rates) so that:
--   - Adding filter dimensions = new ROW per (player, dimension), not
--     new columns
--   - Composing dimensions = summing counts then dividing
--   - Changing rate formulas = display layer change, no re-aggregation
--
-- dimension_key column enables Phase 4 filter splits without schema
-- changes. Phase 3 populates 'all' (no filter) only; Phase 4 adds
-- 'vs_lhp', 'vs_rhp', 'vs_95plus', 'weekday', 'weekend', 'home', 'away',
-- 'high_lev', 'close_game', 'stuff_100plus', 'stuff_105plus' as needed.
--
-- All three tables map 1:1 to consuming Savant page sections (NOT to
-- PlayerProfile.tsx). Existing Savant displays (from Pitching Master /
-- Hitter Master) are NOT touched — these tables sit alongside as a new
-- filter-driven section. See docs/PITCH_LOG_BUILD.md §Phase 5.

-- ────────────────────────────────────────────────────────────────────
-- 1. pitch_log_pitcher_totals
-- ────────────────────────────────────────────────────────────────────
-- One row per (pitcher_id, season, dimension_key). pitcher_id is the
-- TruMedia source_player_id (matches players.source_player_id).

CREATE TABLE IF NOT EXISTS public.pitch_log_pitcher_totals (
  pitcher_id text NOT NULL,
  season integer NOT NULL,
  dimension_key text NOT NULL DEFAULT 'all',

  -- ── Pitch volumes ────────────────────────────────────────────────
  total_pitches integer NOT NULL DEFAULT 0,
  total_swings integer NOT NULL DEFAULT 0,
  total_takes integer NOT NULL DEFAULT 0,           -- pitches - swings

  -- ── Tracking presence ────────────────────────────────────────────
  total_data_pitches integer NOT NULL DEFAULT 0,    -- is_data = TRUE
  total_velo_pitches integer NOT NULL DEFAULT 0,    -- has_velo = TRUE

  -- ── Zone / chase / strike ───────────────────────────────────────
  total_in_zone integer NOT NULL DEFAULT 0,
  total_in_zone_swings integer NOT NULL DEFAULT 0,
  total_in_zone_whiffs integer NOT NULL DEFAULT 0,
  total_chases integer NOT NULL DEFAULT 0,
  total_whiffs integer NOT NULL DEFAULT 0,
  total_strikes integer NOT NULL DEFAULT 0,
  total_fouls integer NOT NULL DEFAULT 0,
  total_called_strikes integer NOT NULL DEFAULT 0,  -- pitch_result = 'Strike Looking'

  -- ── Plate appearance outcomes (pitcher faced) ───────────────────
  total_bf integer NOT NULL DEFAULT 0,              -- batters faced
  total_pa integer NOT NULL DEFAULT 0,              -- equiv to BF on pitcher side
  total_k integer NOT NULL DEFAULT 0,
  total_bb integer NOT NULL DEFAULT 0,
  total_hbp integer NOT NULL DEFAULT 0,

  -- ── Stuff+ aggregate ────────────────────────────────────────────
  stuff_plus_sum numeric,                           -- avg = sum / total_data_pitches
  stuff_plus_data_pitches integer NOT NULL DEFAULT 0, -- denom for avg

  -- ── Audit ───────────────────────────────────────────────────────
  computed_at timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (pitcher_id, season, dimension_key)
);

COMMENT ON TABLE public.pitch_log_pitcher_totals IS
  'Per-pitcher season aggregations from pitch_log. Counts stored, rates derived at display. dimension_key segregates filter splits (Phase 4). Pitch_log is source-of-truth; Pitching Master stays for legacy aggregates.';

CREATE INDEX IF NOT EXISTS idx_plp_totals_dim
  ON public.pitch_log_pitcher_totals(dimension_key, season);

-- ────────────────────────────────────────────────────────────────────
-- 2. pitch_log_pitcher_by_pitch_type
-- ────────────────────────────────────────────────────────────────────
-- One row per (pitcher_id, season, pitch_type_reclassified, dimension_key).
-- Per-pitch-type breakdown for usage %, Stuff+, whiff %, movement profile.

CREATE TABLE IF NOT EXISTS public.pitch_log_pitcher_by_pitch_type (
  pitcher_id text NOT NULL,
  season integer NOT NULL,
  pitch_type_reclassified text NOT NULL,
  dimension_key text NOT NULL DEFAULT 'all',

  -- ── Volumes ──────────────────────────────────────────────────────
  pitches integer NOT NULL DEFAULT 0,
  swings integer NOT NULL DEFAULT 0,
  whiffs integer NOT NULL DEFAULT 0,
  in_zone integer NOT NULL DEFAULT 0,
  in_zone_swings integer NOT NULL DEFAULT 0,
  in_zone_whiffs integer NOT NULL DEFAULT 0,
  chases integer NOT NULL DEFAULT 0,
  called_strikes integer NOT NULL DEFAULT 0,

  -- ── Tracking presence ────────────────────────────────────────────
  data_pitches integer NOT NULL DEFAULT 0,          -- denom for movement avgs + Stuff+
  velo_pitches integer NOT NULL DEFAULT 0,

  -- ── Stuff+ aggregate ────────────────────────────────────────────
  stuff_plus_sum numeric,

  -- ── Movement profile sums (avg = sum / data_pitches) ────────────
  velo_sum numeric,
  ivb_sum numeric,
  hb_sum numeric,
  extension_sum numeric,
  spin_sum numeric,
  rel_height_sum numeric,
  rel_side_sum numeric,

  -- ── Audit ───────────────────────────────────────────────────────
  computed_at timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (pitcher_id, season, pitch_type_reclassified, dimension_key)
);

COMMENT ON TABLE public.pitch_log_pitcher_by_pitch_type IS
  'Per-pitcher per-pitch-type season aggregations. Drives Savant pitch usage + per-type Stuff+ + per-type whiff displays. dimension_key segregates filter splits.';

CREATE INDEX IF NOT EXISTS idx_plp_pt_dim
  ON public.pitch_log_pitcher_by_pitch_type(dimension_key, season, pitch_type_reclassified);
CREATE INDEX IF NOT EXISTS idx_plp_pt_pitcher
  ON public.pitch_log_pitcher_by_pitch_type(pitcher_id, season);

-- ────────────────────────────────────────────────────────────────────
-- 3. pitch_log_hitter_totals
-- ────────────────────────────────────────────────────────────────────
-- One row per (batter_id, season, dimension_key). Hitting outcomes,
-- plate discipline, quality of contact.

CREATE TABLE IF NOT EXISTS public.pitch_log_hitter_totals (
  batter_id text NOT NULL,
  season integer NOT NULL,
  dimension_key text NOT NULL DEFAULT 'all',

  -- ── Plate appearance outcomes ───────────────────────────────────
  pa integer NOT NULL DEFAULT 0,
  ab integer NOT NULL DEFAULT 0,
  hits_single integer NOT NULL DEFAULT 0,
  hits_double integer NOT NULL DEFAULT 0,
  hits_triple integer NOT NULL DEFAULT 0,
  hits_hr integer NOT NULL DEFAULT 0,
  k integer NOT NULL DEFAULT 0,
  bb integer NOT NULL DEFAULT 0,
  hbp integer NOT NULL DEFAULT 0,
  sac integer NOT NULL DEFAULT 0,                   -- sac bunt + sac fly

  -- ── Pitch volumes (seen) ────────────────────────────────────────
  total_pitches integer NOT NULL DEFAULT 0,
  total_swings integer NOT NULL DEFAULT 0,
  total_takes integer NOT NULL DEFAULT 0,

  -- ── Tracking presence ────────────────────────────────────────────
  total_data_pitches integer NOT NULL DEFAULT 0,
  total_velo_pitches integer NOT NULL DEFAULT 0,

  -- ── Zone / chase / whiff ────────────────────────────────────────
  total_in_zone integer NOT NULL DEFAULT 0,
  total_in_zone_swings integer NOT NULL DEFAULT 0,
  total_in_zone_whiffs integer NOT NULL DEFAULT 0,
  total_chases integer NOT NULL DEFAULT 0,
  total_whiffs integer NOT NULL DEFAULT 0,
  total_fouls integer NOT NULL DEFAULT 0,

  -- ── Batted ball profile ─────────────────────────────────────────
  batted_balls_in_play integer NOT NULL DEFAULT 0,
  batted_ground_balls integer NOT NULL DEFAULT 0,
  batted_line_drives integer NOT NULL DEFAULT 0,
  batted_fly_balls integer NOT NULL DEFAULT 0,
  batted_pop_ups integer NOT NULL DEFAULT 0,
  batted_barrels integer NOT NULL DEFAULT 0,
  batted_hard_hit integer NOT NULL DEFAULT 0,
  batted_la_10_to_30 integer NOT NULL DEFAULT 0,

  -- ── Exit velocity aggregate (avg = sum / batted_balls_with_ev) ──
  ev_sum numeric,
  batted_balls_with_ev integer NOT NULL DEFAULT 0,

  -- ── Audit ───────────────────────────────────────────────────────
  computed_at timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (batter_id, season, dimension_key)
);

COMMENT ON TABLE public.pitch_log_hitter_totals IS
  'Per-hitter season aggregations from pitch_log. Slash line, plate discipline, quality of contact. EV90 deliberately NOT stored — Pitching Master remains the source if ever needed.';

CREATE INDEX IF NOT EXISTS idx_plh_totals_dim
  ON public.pitch_log_hitter_totals(dimension_key, season);
