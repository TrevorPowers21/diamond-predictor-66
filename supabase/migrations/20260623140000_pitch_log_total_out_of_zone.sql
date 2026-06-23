-- ════════════════════════════════════════════════════════════════════
-- 2026-06-23 — Add total_out_of_zone column to pitch_log aggregations
-- ════════════════════════════════════════════════════════════════════
--
-- WHY
-- ───
-- The current Chase% formula was:
--   chase = chases / (total_pitches - total_in_zone)
--
-- The denominator was inflated by NULL/untracked pitches (cs_prob IS
-- NULL): those don't have is_in_zone set true OR false, but the
-- subtraction lumps them into the "out of zone" bucket. Numerator
-- (chases) requires is_in_zone IS FALSE explicitly, so the bucket
-- mismatch crashed Chase% rates to ~70% of true value across the
-- entire qualified D1 hitter pop:
--
--     Population median Chase%:
--       Old formula (chs / (total - in_zone))   = 16.9%
--       HM stored chase median (same metric)    = 22.9%
--       Correct (chs / count is_in_zone=FALSE)  = ~22-23% (per-player
--                                                 audit confirms)
--
-- THE FIX
-- ───────
-- New column total_out_of_zone explicitly counts pitches where
-- is_in_zone IS FALSE — matching the chases numerator's filter.
-- Standard MLB O-Swing% / Chase% definition:
--   Chase% = swings on OOZ pitches / total OOZ pitches
--   both sides restricted to is_in_zone IS FALSE.
--
-- Same fix applies to Zone% (37.9% league avg under old formula vs
-- ~47% under the corrected formula on tracked-only pitches).
--
-- Mirror columns added on pitcher-side tables (the chase-against
-- definition coaches care about).
-- ════════════════════════════════════════════════════════════════════

-- ── Hitter side ────────────────────────────────────────────────────
ALTER TABLE public.pitch_log_hitter_totals
  ADD COLUMN IF NOT EXISTS total_out_of_zone integer NOT NULL DEFAULT 0;

ALTER TABLE public.pitch_log_hitter_by_pitch_type
  ADD COLUMN IF NOT EXISTS out_of_zone integer NOT NULL DEFAULT 0;

-- ── Pitcher side ───────────────────────────────────────────────────
ALTER TABLE public.pitch_log_pitcher_totals
  ADD COLUMN IF NOT EXISTS total_out_of_zone integer NOT NULL DEFAULT 0;

ALTER TABLE public.pitch_log_pitcher_by_pitch_type
  ADD COLUMN IF NOT EXISTS out_of_zone integer NOT NULL DEFAULT 0;
