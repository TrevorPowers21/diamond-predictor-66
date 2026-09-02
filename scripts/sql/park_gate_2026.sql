with prim as (
  select distinct on (home_source_team_id)
    home_source_team_id as src, game_venue_id, g_home,
    rg_raw, avg_all, obp_all, iso_all
  from _park_pitchlog_2026_raw
  where home_source_team_id is not null
  order by home_source_team_id, g_home desc nulls last
),
lg as (
  select avg(rg_raw) rg, avg(avg_all) avg, avg(obp_all) obp, avg(iso_all) iso
  from prim where g_home >= 10
),
fac as (
  select p.src, p.g_home,
    (p.rg_raw / lg.rg * 100)  as rg_f,
    (p.avg_all/ lg.avg* 100)  as avg_f,
    (p.obp_all/ lg.obp* 100)  as obp_f,
    (p.iso_all/ lg.iso* 100)  as iso_f
  from prim p cross join lg
  where p.g_home >= 10
)
select
  count(*) n,
  round(avg(abs(f.avg_f - s.avg_factor_seasonal))::numeric,2) avg_mad,
  round(avg(abs(f.obp_f - s.obp_factor_seasonal))::numeric,2) obp_mad,
  round(avg(abs(f.iso_f - s.iso_factor_seasonal))::numeric,2) iso_mad,
  round(avg(abs(f.rg_f  - s.rg_factor_seasonal ))::numeric,2) rg_mad,
  round(corr(f.iso_f, s.iso_factor_seasonal)::numeric,3) iso_corr,
  round(corr(f.rg_f,  s.rg_factor_seasonal )::numeric,3) rg_corr
from fac f
join "Park Factors" s on s.source_team_id = f.src and s.season = 2026;
