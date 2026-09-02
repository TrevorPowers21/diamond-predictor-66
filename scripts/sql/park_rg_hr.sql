with game_scores as (
  select split_part(uniq_pitch_id,'-',1) game_id,
    max(batting_team_id) filter (where home)     home_team,
    max(batting_team_id) filter (where not home) away_team,
    max(total_runs)      filter (where home)     home_runs,
    max(total_runs)      filter (where not home) away_runs
  from pitch_log where season=2026 and total_runs is not null and game_venue_id is not null
  group by 1
),
gs as (select * from game_scores where home_team is not null and away_team is not null and home_runs is not null and away_runs is not null),
splits as (
  select home_team team, (home_runs+away_runs) tot, 1 h from gs
  union all
  select away_team,       (home_runs+away_runs), 0     from gs
),
tr as (
  select team, avg(tot) filter (where h=1) home_rg, avg(tot) filter (where h=0) road_rg,
         count(*) filter (where h=1) hg, count(*) filter (where h=0) rg
  from splits group by team
),
lg as (select avg(home_rg/nullif(road_rg,0)) m from tr where hg>=10 and rg>=10),
fac as (select t.team, t.home_rg/t.road_rg/lg.m*100 rg_f from tr t cross join lg where t.hg>=10 and t.rg>=10)
select count(*) n,
  round(avg(abs(f.rg_f - s.rg_factor_seasonal))::numeric,2) rg_mad,
  round(corr(f.rg_f, s.rg_factor_seasonal)::numeric,3) rg_corr
from fac f join "Park Factors" s on s.source_team_id=f.team and s.season=2026;
