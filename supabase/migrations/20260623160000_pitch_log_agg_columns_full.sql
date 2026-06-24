-- 2026-06-23 — Pitch Log aggregation column completion
--
-- The aggregation script (scripts/aggregate_pitch_log_dimensions.ts) grew
-- substantially through the Phase 5 session: pitcher-allowed batted-ball
-- counts, hits-against, xStats sums, FB velo aggregate, and AB. The
-- original aggregation tables migration (20260620120000) only created
-- the base set; this migration brings the schemas in line with what the
-- aggregation script expects.
--
-- All adds are idempotent (`IF NOT EXISTS`) and defaulted, so existing
-- rows pick up 0 / NULL on first read.

-- pitch_log_pitcher_totals — full pitcher-side aggregations
ALTER TABLE public.pitch_log_pitcher_totals
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_in_play integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_barrels_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_hard_hit_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_with_ev integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_ground_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_line_drives_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_fly_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pop_ups_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_single_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_double_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_triple_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_hr_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ab integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS x_hits_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS fb_velo_sum numeric,
  ADD COLUMN IF NOT EXISTS fb_velo_pitches integer NOT NULL DEFAULT 0;

-- pitch_log_pitcher_by_pitch_type — same set + per-type AB
ALTER TABLE public.pitch_log_pitcher_by_pitch_type
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_in_play integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_barrels_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_hard_hit_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_with_ev integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_ground_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_line_drives_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_fly_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pop_ups_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_single_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_double_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_triple_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_hr_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ab integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS x_hits_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum_allowed numeric;

-- pitch_log_hitter_totals — max EV + xStats sums
ALTER TABLE public.pitch_log_hitter_totals
  ADD COLUMN IF NOT EXISTS max_ev numeric,
  ADD COLUMN IF NOT EXISTS x_hits_sum numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum numeric;

-- pitch_log_hitter_by_pitch_type — max EV + xStats sums
ALTER TABLE public.pitch_log_hitter_by_pitch_type
  ADD COLUMN IF NOT EXISTS max_ev numeric,
  ADD COLUMN IF NOT EXISTS x_hits_sum numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum numeric;
