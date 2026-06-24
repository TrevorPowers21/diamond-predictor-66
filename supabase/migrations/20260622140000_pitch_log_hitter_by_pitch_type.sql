-- 2026-06-22 — Per-hitter per-pitch-type aggregation (Phase 5c)
--
-- Mirrors pitch_log_pitcher_by_pitch_type but from the HITTER's side: how
-- did each hitter perform against each pitch type, across each filter
-- dimension. Drives the Stats page's per-pitch-type batting line table
-- (Savant-style "vs FB / vs SL / vs CB / vs CH" panel).
--
-- One row per (batter_id, season, pitch_type_reclassified, dimension_key).
-- All counts — rates derived at display.

CREATE TABLE IF NOT EXISTS public.pitch_log_hitter_by_pitch_type (
  batter_id text NOT NULL,
  season integer NOT NULL,
  pitch_type_reclassified text NOT NULL,
  dimension_key text NOT NULL DEFAULT 'all',

  -- ── Outcome counts ──────────────────────────────────────────────
  pa integer NOT NULL DEFAULT 0,
  ab integer NOT NULL DEFAULT 0,
  hits_single integer NOT NULL DEFAULT 0,
  hits_double integer NOT NULL DEFAULT 0,
  hits_triple integer NOT NULL DEFAULT 0,
  hits_hr integer NOT NULL DEFAULT 0,
  k integer NOT NULL DEFAULT 0,
  bb integer NOT NULL DEFAULT 0,
  hbp integer NOT NULL DEFAULT 0,

  -- ── Volumes seen ────────────────────────────────────────────────
  pitches integer NOT NULL DEFAULT 0,
  swings integer NOT NULL DEFAULT 0,
  whiffs integer NOT NULL DEFAULT 0,
  chases integer NOT NULL DEFAULT 0,
  in_zone integer NOT NULL DEFAULT 0,
  in_zone_swings integer NOT NULL DEFAULT 0,
  in_zone_whiffs integer NOT NULL DEFAULT 0,
  fouls integer NOT NULL DEFAULT 0,

  -- ── Quality of contact ──────────────────────────────────────────
  batted_balls_in_play integer NOT NULL DEFAULT 0,
  batted_barrels integer NOT NULL DEFAULT 0,
  batted_hard_hit integer NOT NULL DEFAULT 0,
  ev_sum numeric,
  batted_balls_with_ev integer NOT NULL DEFAULT 0,

  computed_at timestamptz NOT NULL DEFAULT NOW(),

  PRIMARY KEY (batter_id, season, pitch_type_reclassified, dimension_key)
);

COMMENT ON TABLE public.pitch_log_hitter_by_pitch_type IS
  'Per-hitter per-pitch-type season aggregations. Drives Stats page Savant-style "vs FB / vs SL / vs CB / vs CH" batting-line table. dimension_key segregates filter splits.';

CREATE INDEX IF NOT EXISTS idx_plh_pt_dim
  ON public.pitch_log_hitter_by_pitch_type(dimension_key, season, pitch_type_reclassified);
CREATE INDEX IF NOT EXISTS idx_plh_pt_batter
  ON public.pitch_log_hitter_by_pitch_type(batter_id, season);

-- RLS (matches the pattern in 20260622120000_pitch_log_rls.sql)
ALTER TABLE public.pitch_log_hitter_by_pitch_type ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitch_log_hitter_by_pitch_type"
  ON public.pitch_log_hitter_by_pitch_type
  FOR SELECT TO authenticated USING (true);
