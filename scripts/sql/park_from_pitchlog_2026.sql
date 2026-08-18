-- Park factors from pitch_log (2026) — venue-attributed, 50/50 home/visitor
-- team-quality control, mirroring the TruMedia (hitter+pitcher)/2 method.
-- Writes _park_pitchlog_2026_raw: one row per venue with blended raw metrics
-- (ALL/LHB/RHB), R/G, sample sizes, and the venue's modal home team (source id).
-- AVG=H/AB · OBP=(H+BB+HBP)/(AB+BB+HBP+SF) · ISO=(2B+2*3B+3*HR)/AB=(TB-H)/AB.
-- R/G = mean per-game final (total_runs) per side. game id = split_part(uniq_pitch_id,'-',1).
-- (drop the table separately before running this file.)
create table _park_pitchlog_2026_raw as
with
game_finals as (
  select game_venue_id, split_part(uniq_pitch_id,'-',1) as game_id, home,
         max(total_runs) as final_runs
  from pitch_log
  where season=2026 and game_venue_id is not null and total_runs is not null
  group by 1,2,3
),
rg as (
  select game_venue_id,
         avg(final_runs) filter (where home)    as rg_home,
         avg(final_runs) filter (where not home) as rg_away,
         count(*) filter (where home)           as g_home,
         count(*) filter (where not home)       as g_away
  from game_finals group by 1
),
term as (
  select game_venue_id, home, batter_hand,
         pitch_result_category as prc, pitch_result as pr
  from pitch_log
  where season=2026 and game_venue_id is not null
    and pitch_result_category is not null
    and pitch_result_category not in ('Ball','Strike','Foul')
),
-- PA counts at ALL/L/R cohort grain (combined = true all-PA counts, not an avg of hand rates)
pa as (
  select game_venue_id, home, cohort,
    count(*) filter (where prc in ('Single','Double','Triple','HR'))                                                          as h,
    count(*) filter (where prc='Double')                                                                                       as d2,
    count(*) filter (where prc='Triple')                                                                                       as d3,
    count(*) filter (where prc='HR')                                                                                           as hr,
    count(*) filter (where prc in ('Single','Double','Triple','HR','GroundOut','FlyOut','PopOut','LineOut','Strikeout','FieldersChoice','DoublePlay','Error')) as ab,
    count(*) filter (where prc='Walk')                                                                                          as bb,
    count(*) filter (where prc='HBP')                                                                                           as hbp,
    count(*) filter (where pr='Sac Fly')                                                                                        as sf
  from (
    select game_venue_id, home, prc, pr, 'ALL'::text as cohort from term
    union all
    select game_venue_id, home, prc, pr, batter_hand from term where batter_hand in ('L','R')
  ) t
  group by 1,2,3
),
rates as (
  select game_venue_id, home, cohort, ab,
    case when ab>0 then h::numeric/ab end                                  as avg,
    case when (ab+bb+hbp+sf)>0 then (h+bb+hbp)::numeric/(ab+bb+hbp+sf) end  as obp,
    case when ab>0 then (d2 + 2*d3 + 3*hr)::numeric/ab end                 as iso
  from pa
),
-- 50/50 home/visitor blend per venue+cohort
blended as (
  select game_venue_id, cohort,
    (avg(avg) filter (where home) + avg(avg) filter (where not home))/2 as avg_raw,
    (avg(obp) filter (where home) + avg(obp) filter (where not home))/2 as obp_raw,
    (avg(iso) filter (where home) + avg(iso) filter (where not home))/2 as iso_raw,
    sum(ab) as ab_total
  from rates group by 1,2
),
home_team as (
  select game_venue_id, batting_team_id,
         row_number() over (partition by game_venue_id order by count(*) desc) rn
  from pitch_log
  where season=2026 and home and game_venue_id is not null and batting_team_id is not null
  group by 1,2
)
select
  v.game_venue_id,
  ht.batting_team_id as home_source_team_id,
  rg.rg_home, rg.rg_away, rg.g_home, rg.g_away,
  (coalesce(rg.rg_home,rg.rg_away) + coalesce(rg.rg_away,rg.rg_home))/2 as rg_raw,
  ba.avg_raw as avg_all, ba.obp_raw as obp_all, ba.iso_raw as iso_all, ba.ab_total as ab_all,
  bl.avg_raw as avg_l,   bl.obp_raw as obp_l,   bl.iso_raw as iso_l,   bl.ab_total as ab_l,
  br.avg_raw as avg_r,   br.obp_raw as obp_r,   br.iso_raw as iso_r,   br.ab_total as ab_r
from (select distinct game_venue_id from blended) v
left join blended ba on ba.game_venue_id=v.game_venue_id and ba.cohort='ALL'
left join blended bl on bl.game_venue_id=v.game_venue_id and bl.cohort='L'
left join blended br on br.game_venue_id=v.game_venue_id and br.cohort='R'
left join rg on rg.game_venue_id=v.game_venue_id
left join home_team ht on ht.game_venue_id=v.game_venue_id and ht.rn=1;
