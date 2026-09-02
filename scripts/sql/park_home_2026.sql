-- Park factors from pitch_log (2026) — HOME-FLAG based, keyed on the CLEAN team_id
-- (batting_team_id is CORRUPT: 1 id -> up to 15 teams; team_id<-teamId is clean).
-- A team's park = ALL its home games (home flag + team_id), both teams' bats.
-- AVG=H/AB · OBP=(H+BB+HBP)/(AB+BB+HBP+SF) · ISO=(2B+2*3B+3*HR)/AB · R/G=avg(both-team total runs).
create table _park_home_2026 as
with
gh as ( -- game -> its home team (clean team_id) + both-team final runs
  select split_part(uniq_pitch_id,'-',1) as game_id,
    max(team_id)    filter (where home)     as home_team,
    max(total_runs) filter (where home)     as home_runs,
    max(total_runs) filter (where not home)  as away_runs
  from pitch_log where season=2026 and total_runs is not null
  group by 1
),
rg as (
  select home_team as team, avg(home_runs + away_runs) as rg_raw, count(*) as g
  from gh where home_team is not null and home_runs is not null and away_runs is not null
  group by 1
),
term as (
  select split_part(uniq_pitch_id,'-',1) as game_id, batter_hand, pitch_result_category as prc, pitch_result as pr
  from pitch_log
  where season=2026 and pitch_result_category is not null and pitch_result_category not in ('Ball','Strike','Foul')
),
pa as (
  select gh.home_team as team, x.cohort,
    count(*) filter (where prc in ('Single','Double','Triple','HR'))                                                          as h,
    count(*) filter (where prc='Double')                                                                                       as d2,
    count(*) filter (where prc='Triple')                                                                                       as d3,
    count(*) filter (where prc='HR')                                                                                           as hr,
    count(*) filter (where prc in ('Single','Double','Triple','HR','GroundOut','FlyOut','PopOut','LineOut','Strikeout','FieldersChoice','DoublePlay','Error')) as ab,
    count(*) filter (where prc='Walk')                                                                                          as bb,
    count(*) filter (where prc='HBP')                                                                                           as hbp,
    count(*) filter (where pr='Sac Fly')                                                                                        as sf
  from (select game_id, prc, pr, 'ALL'::text as cohort from term
        union all
        select game_id, prc, pr, batter_hand from term where batter_hand in ('L','R')) x
  join gh on gh.game_id = x.game_id
  where gh.home_team is not null
  group by 1,2
),
rates as (
  select team, cohort,
    case when ab>0 then h::numeric/ab end                                 as avg,
    case when (ab+bb+hbp+sf)>0 then (h+bb+hbp)::numeric/(ab+bb+hbp+sf) end as obp,
    case when ab>0 then (d2 + 2*d3 + 3*hr)::numeric/ab end                as iso
  from pa
)
select
  coalesce(ra.team, rg.team) as team, rg.g as home_games, rg.rg_raw,
  ra.avg as avg_all, ra.obp as obp_all, ra.iso as iso_all,
  rl.avg as avg_l, rl.obp as obp_l, rl.iso as iso_l,
  rr.avg as avg_r, rr.obp as obp_r, rr.iso as iso_r
from rates ra
left join rates rl on rl.team=ra.team and rl.cohort='L'
left join rates rr on rr.team=ra.team and rr.cohort='R'
left join rg on rg.team=ra.team
where ra.cohort='ALL';
