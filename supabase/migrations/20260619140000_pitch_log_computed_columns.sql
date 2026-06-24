-- 2026-06-19 — Pitch Log Phase 2: computed columns
--
-- Adds the columns needed for outcome classification, breaking-ball
-- reclassification, and Stuff+ per pitch. All nullable here — populated
-- by post-ingest passes (see scripts/derive_pitch_log_flags.ts and
-- scripts/compute_pitch_log_stuff_plus.ts).
--
-- This separation (add columns now, populate later) matches Trevor's
-- "build columns first, then run computes post ingest" preference.
-- Lets us re-derive any column without dropping/recreating it.

-- ── Outcome flags ──────────────────────────────────────────────────────
-- All derived from pitch_result + cs_prob. Populated by a single SQL
-- UPDATE pass (see scripts/derive_pitch_log_flags.ts).

ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS is_foul boolean,
  -- Pitch was a foul ball. Excludes EV/LA from downstream movement
  -- aggregations even though TruMedia carries EV on fouls. Per the
  -- locked ruling in Session 1 doc §5.

  ADD COLUMN IF NOT EXISTS is_in_zone boolean,
  -- cs_prob >= 0.50. NULL when cs_prob itself is NULL (rare untracked
  -- pitch where we don't know if it was in the zone).

  ADD COLUMN IF NOT EXISTS is_strike boolean,
  -- Per Session 1 doc §5: strike looking + strike swinging + foul tip
  -- + ball in play. Used as the numerator for strike rate.

  ADD COLUMN IF NOT EXISTS is_swing boolean,
  -- Any swing attempt. Swinging strikes, fouls (typically), and all
  -- batted balls. NOT looking strikes, called balls, walks, HBP.

  ADD COLUMN IF NOT EXISTS is_whiff boolean,
  -- Swinging strike (strike swinging or strikeout swinging). Same as
  -- "miss" in Session 1 doc.

  ADD COLUMN IF NOT EXISTS is_chase boolean,
  -- Swing on a pitch outside the zone. is_swing AND NOT is_in_zone.

  ADD COLUMN IF NOT EXISTS is_in_play boolean,
  -- Ball put in play (hit, out, error, sac, fielder's choice, double
  -- play). Excludes fouls. Denominator for most batted-ball rates.

  ADD COLUMN IF NOT EXISTS is_batted_ball_in_play boolean,
  -- Per Session 2 doc §"Metric Refinements": batted ball in play —
  -- foul excluded. Avg EV / EV90 use this as the denominator.

  ADD COLUMN IF NOT EXISTS pitch_result_category text;
  -- Normalized outcome: Strike / Ball / Walk / HBP / HR / Single /
  -- Double / Triple / GroundOut / FlyOut / LineOut / PopOut / Sac /
  -- Error / Strikeout / Foul / Other.

COMMENT ON COLUMN public.pitch_log.pitch_result_category IS
  'Normalized outcome bucket parsed from pitch_result. Values: Strike/Ball/Walk/HBP/HR/Single/Double/Triple/GroundOut/FlyOut/LineOut/PopOut/Sac/Error/Strikeout/Foul/Other.';

-- ── Reclassified pitch type ────────────────────────────────────────────
-- Per pitch, runs src/savant/lib/breakingBallReclassification.ts logic
-- (reclassifyRHP / reclassifyLHP) against this pitch''s ivb, hb, and
-- rel_height. Splits raw "SL" into Slider / Sweeper / Gyro Slider /
-- Cutter / Curveball based on movement profile.
--
-- NULL when is_data = FALSE (no movement → can''t reclassify) or when
-- raw pitch_type is non-breaking (FA, SI, CH, FS — kept as-is via the
-- script).

ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS pitch_type_reclassified text;

COMMENT ON COLUMN public.pitch_log.pitch_type_reclassified IS
  'Pitch type after applying breakingBallReclassification logic per pitch. Possible values: 4-Seam Fastball, Sinker, Cutter, Slider, Sweeper, Gyro Slider, Curveball, Change-up, Splitter, Unknown. NULL when is_data = FALSE.';

-- ── Stuff+ per pitch ──────────────────────────────────────────────────
-- Per pitch, runs src/savant/lib/stuffPlusEngine.ts:calculateStuffPlus()
-- using the reclassified pitch type + pop constants from
-- pitcher_stuff_plus_ncaa. Then a recenter pass adjusts each
-- (pitch_type × hand) bucket so the bucket mean == 100 (Option A from
-- the Phase 2 spec).

ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS stuff_plus numeric(6,2);

COMMENT ON COLUMN public.pitch_log.stuff_plus IS
  'Per-pitch Stuff+ score from src/savant/lib/stuffPlusEngine.ts, recentered so each (pitch_type_reclassified × pitcher_hand) bucket has mean=100. NULL when is_data = FALSE or required pop constants missing.';

-- ── Indexes for filter dimensions ─────────────────────────────────────
-- Filter UI in Phase 5 will frequently query by pitch_type_reclassified
-- and pitcher_hand combinations. Pre-index the common slices.

CREATE INDEX IF NOT EXISTS idx_pitch_log_reclassified_hand
  ON public.pitch_log(pitch_type_reclassified, pitcher_hand);

CREATE INDEX IF NOT EXISTS idx_pitch_log_in_zone
  ON public.pitch_log(is_in_zone)
  WHERE is_in_zone IS NOT NULL;
