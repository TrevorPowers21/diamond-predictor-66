-- Pitch Log: per-row spray classification + accumulated section/direction
-- counts, pull-air, LA 10-30 allowed, and EV90.
--
-- Architecture (per Trevor): classify every batted ball ONCE on the row
-- (like is_strike / pitch_result_category), then aggregation just counts.
--
--   hit_location     : absolute field section from spray_ang
--                      far_left | left_center | center | right_center | far_right
--                      cutoffs  -45..-30 | -30..-15 | -15..15 | 15..30 | 30..45
--   batted_direction : pull | center | oppo, from spray_ang + that row's
--                      batter_hand (RHB pulls left, LHB pulls right).
--                      Center band is +/-15, matching Hitter/Pitching Master
--                      HPull% so the power-rating baseline stays calibrated.
--                      Per-row hand => switch hitters resolve exactly.
--
-- All additive. Counts default 0; EV90 is a nullable percentile (computed
-- directly in the aggregator via percentile_cont, NOT derivable from sums).

-- ── Per-row classification on the raw log ────────────────────────────────
ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS hit_location     text,
  ADD COLUMN IF NOT EXISTS batted_direction text;

CREATE INDEX IF NOT EXISTS idx_pitch_log_hit_location ON public.pitch_log (hit_location) WHERE hit_location IS NOT NULL;

COMMENT ON COLUMN public.pitch_log.hit_location IS
  'Absolute field section of a batted ball in play, from spray_ang: far_left (-45..-30), left_center (-30..-15), center (-15..15), right_center (15..30), far_right (30..45). NULL if not BIP or no spray_ang.';
COMMENT ON COLUMN public.pitch_log.batted_direction IS
  'pull | center | oppo from spray_ang + batter_hand (RHB pulls left, LHB pulls right). Center band +/-15 (matches Master HPull%). NULL if not BIP or no spray_ang/hand.';

-- ── Pitcher totals (allowed direction + rating inputs) ───────────────────
ALTER TABLE public.pitch_log_pitcher_totals
  ADD COLUMN IF NOT EXISTS batted_pull_allowed          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_center_allowed        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_oppo_allowed          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull_air_allowed      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_la_10_to_30_allowed   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_90_allowed                numeric;

-- ── Hitter totals (own 5 sections + direction + rating inputs) ───────────
ALTER TABLE public.pitch_log_hitter_totals
  ADD COLUMN IF NOT EXISTS batted_far_left     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_left_center  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_center       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_right_center integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_far_right    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_oppo         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull_air     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_90               numeric;
-- (hitter "center" direction count == batted_center section; no separate column.)
