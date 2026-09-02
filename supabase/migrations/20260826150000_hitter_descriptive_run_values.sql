-- Hitter descriptive Run Values + national z-scores on the season-stats rollup.
--
-- Three last-season (descriptive, NOT projection) run values shown as a "VALUE"
-- cluster on the hitter Season Stats banner (position players, unfiltered view only):
--   batting_rv     = ((wRC+ - 100)/100) * PA * 0.3994   (from the stored season counts)
--   defensive_rv   = player_season_defense.drs_floor     (DRS engine, season)
--   baserunning_rv = player_season_baserunning.wsb_runs   (season)
-- plus each value's *_z = national z-score over the qualified 2026 D1 population
--   (batting pa>=50 / defensive half_innings>=50 / baserunning opportunities>=20).
--
-- Populated ONLY on the dimension_key='all' rows by aggregate_pitch_log_dimensions.ts
-- and by the process-precompute-jobs edge fn (season-stats stage), so it auto-updates
-- as the next season accrues. Display pure-reads these (no live compute) and colors the
-- chip by the stored _z percentile. Additive + idempotent.
alter table public.pitch_log_hitter_totals
  add column if not exists batting_rv        double precision,
  add column if not exists batting_rv_z      double precision,
  add column if not exists defensive_rv      double precision,
  add column if not exists defensive_rv_z    double precision,
  add column if not exists baserunning_rv    double precision,
  add column if not exists baserunning_rv_z  double precision;
