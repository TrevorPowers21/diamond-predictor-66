-- ============================================================================
-- Inferred Bat Speed & Squared-Up — per hitter-season build
-- ----------------------------------------------------------------------------
-- Read-only against pitch_log (batted-ball outcomes only). Additive: writes a
-- standalone hitter_bat_speed_season table, never mutates the raw log.
-- Idempotent + re-runnable: CREATE IF NOT EXISTS, then TRUNCATE + reload.
--
-- Method (per qualifying batted ball, after the 3 outlier layers):
--   implied_bat_speed = (exit_velocity - 0.242*release_velocity) / 1.242
-- Per (batter_id, season): floor=p95, ceiling=p99, runway=ceiling-floor.
-- Squared-up reuses that ceiling as the denominator, threshold T=0.90.
--
-- Outlier layers, order is LOAD-BEARING (fence must run BEFORE percentiles):
--   1. plausibility bounds: EV in [30,125], release velo in [55,105]
--   2. chop-misread: drop EV>=118 AND launch_angle<-10 (physically impossible)
--   3. tail fence per hitter-season: drop EV > p95(EV)+8
--
-- Column map (pitch_log): exit_velocity, release_velocity(=pitch velo),
--   launch_angle, batter_id (text = source_player_id), season (int).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hitter_bat_speed_season (
  batter_id          text    NOT NULL,
  season             integer NOT NULL,
  qualified_bip      integer NOT NULL,
  bat_speed_floor    numeric,      -- p95 implied bat speed
  bat_speed_ceiling  numeric,      -- p99 implied bat speed
  runway             numeric,      -- ceiling - floor
  squared_up_rate    numeric,      -- % of batted balls with squared_up_pct >= 0.90
  avg_squared_up_pct numeric,
  confidence         text,         -- A>=120, B>=60, C>=30 qualified BIP
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batter_id, season)
);

ALTER TABLE public.hitter_bat_speed_season ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hitter_bat_speed_season_read ON public.hitter_bat_speed_season;
CREATE POLICY hitter_bat_speed_season_read ON public.hitter_bat_speed_season
  FOR SELECT TO authenticated USING (true);

TRUNCATE public.hitter_bat_speed_season;

INSERT INTO public.hitter_bat_speed_season
  (batter_id, season, qualified_bip, bat_speed_floor, bat_speed_ceiling, runway,
   squared_up_rate, avg_squared_up_pct, confidence)
WITH base AS (
  SELECT batter_id, season, exit_velocity, release_velocity,
         (exit_velocity - 0.242 * release_velocity) / 1.242 AS implied_bat_speed
  FROM public.pitch_log
  WHERE is_batted_ball_in_play = true
    AND exit_velocity BETWEEN 30 AND 125
    AND release_velocity BETWEEN 55 AND 105
    AND NOT (exit_velocity >= 118 AND launch_angle < -10)
),
fence AS (   -- tail-outlier fence per hitter-season, computed BEFORE percentiles
  SELECT batter_id, season,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY exit_velocity) + 8 AS ev_fence
  FROM base
  GROUP BY batter_id, season
),
clean AS (
  SELECT b.*
  FROM base b
  JOIN fence f USING (batter_id, season)
  WHERE b.exit_velocity <= f.ev_fence
),
agg AS (
  SELECT batter_id, season,
         COUNT(*) AS qualified_bip,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY implied_bat_speed) AS floor_bs,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY implied_bat_speed) AS ceiling_bs
  FROM clean
  GROUP BY batter_id, season
),
sq AS (   -- squared-up uses each hitter's ceiling as the max-EV denominator
  SELECT c.batter_id, c.season,
         AVG( (c.exit_velocity
               / (1.242 * a.ceiling_bs + 0.242 * c.release_velocity) >= 0.90)::int
             )::numeric * 100 AS squared_up_rate,
         AVG(  c.exit_velocity
               / (1.242 * a.ceiling_bs + 0.242 * c.release_velocity)
             )::numeric        AS avg_sq
  FROM clean c
  JOIN agg a USING (batter_id, season)
  GROUP BY c.batter_id, c.season
)
SELECT a.batter_id, a.season, a.qualified_bip,
       ROUND(a.floor_bs::numeric, 1),
       ROUND(a.ceiling_bs::numeric, 1),
       ROUND((a.ceiling_bs - a.floor_bs)::numeric, 1),
       ROUND(sq.squared_up_rate, 0),
       ROUND(sq.avg_sq, 3),
       CASE WHEN a.qualified_bip >= 120 THEN 'A'
            WHEN a.qualified_bip >= 60  THEN 'B'
            WHEN a.qualified_bip >= 30  THEN 'C'
            ELSE 'INSUFFICIENT' END
FROM agg a
JOIN sq USING (batter_id, season)
WHERE a.qualified_bip >= 30;

NOTIFY pgrst, 'reload schema';
