-- populate_hitter_run_values(season): fills the three descriptive hitter run values
-- + their national z-scores on the pitch_log_hitter_totals 'all' rows. Called by
-- aggregate_pitch_log_dimensions.ts (batch) AND the process-precompute-jobs edge fn
-- (season-stats stage) so it auto-updates as a season accrues. Idempotent.
--
--   batting_rv     = ((wRC+ - 100)/100) * PA * 0.3994, wRC+ from the stored season
--                    counts using the SAME OBP/SLG the banner displays
--                    (OBP = (H+BB+HBP)/(AB+BB+HBP+SAC), SLG = TB/AB).
--   defensive_rv   = player_season_defense.drs_floor (same-season)
--   baserunning_rv = player_season_baserunning.wsb_runs (same-season)
--   *_z            = (rv - mean)/stddev_pop over the QUALIFIED national population
--                    (batting pa>=50 / defensive half_innings>=50 / baserunning
--                    opportunities>=20); z applied to all rows off the qualified moments.
create or replace function public.populate_hitter_run_values(target_season int)
returns integer
language plpgsql
as $$
declare n integer := 0;
begin
  -- 1) batting_rv from stored season counts (mirrors HitterStatsLine OBP/SLG exactly)
  update public.pitch_log_hitter_totals t
  set batting_rv = (
        ( ( ( 0.011
              + 0.691 * ((t.hits_single + t.hits_double + t.hits_triple + t.hits_hr + t.bb + t.hbp)::double precision
                          / nullif(t.ab + t.bb + t.hbp + t.sac, 0))
              + 0.235 * ((t.hits_single + 2*t.hits_double + 3*t.hits_triple + 4*t.hits_hr)::double precision
                          / nullif(t.ab, 0))
            ) / 0.3782 ) * 100.0 - 100.0 ) / 100.0
      ) * t.pa * 0.3994
  where t.season = target_season and t.dimension_key = 'all'
    and t.ab > 0 and (t.ab + t.bb + t.hbp + t.sac) > 0;

  -- 2) defensive_rv = season DRS floor
  update public.pitch_log_hitter_totals t
  set defensive_rv = d.drs_floor
  from public.player_season_defense d
  where t.season = target_season and t.dimension_key = 'all'
    and d.season = target_season and d.source_player_id = t.batter_id;

  -- 3) baserunning_rv = season wSB runs
  update public.pitch_log_hitter_totals t
  set baserunning_rv = b.wsb_runs
  from public.player_season_baserunning b
  where t.season = target_season and t.dimension_key = 'all'
    and b.season = target_season and b.source_player_id = t.batter_id;

  -- 4) national z-scores over the qualified populations
  with bat as (
    select avg(batting_rv) m, stddev_pop(batting_rv) s
    from public.pitch_log_hitter_totals
    where season = target_season and dimension_key = 'all' and batting_rv is not null and pa >= 50
  ),
  def as (
    select avg(t.defensive_rv) m, stddev_pop(t.defensive_rv) s
    from public.pitch_log_hitter_totals t
    join public.player_season_defense d on d.season = target_season and d.source_player_id = t.batter_id
    where t.season = target_season and t.dimension_key = 'all' and t.defensive_rv is not null and d.half_innings >= 50
  ),
  bsr as (
    select avg(t.baserunning_rv) m, stddev_pop(t.baserunning_rv) s
    from public.pitch_log_hitter_totals t
    join public.player_season_baserunning b on b.season = target_season and b.source_player_id = t.batter_id
    where t.season = target_season and t.dimension_key = 'all' and t.baserunning_rv is not null and b.opportunities >= 20
  )
  update public.pitch_log_hitter_totals t
  set batting_rv_z     = case when t.batting_rv     is not null and (select s from bat) > 0 then (t.batting_rv     - (select m from bat)) / (select s from bat) end,
      defensive_rv_z   = case when t.defensive_rv   is not null and (select s from def) > 0 then (t.defensive_rv   - (select m from def)) / (select s from def) end,
      baserunning_rv_z = case when t.baserunning_rv is not null and (select s from bsr) > 0 then (t.baserunning_rv - (select m from bsr)) / (select s from bsr) end
  where t.season = target_season and t.dimension_key = 'all';

  get diagnostics n = row_count;
  return n;
end;
$$;
