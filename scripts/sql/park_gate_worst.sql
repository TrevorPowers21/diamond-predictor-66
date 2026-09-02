with prim as (
  select distinct on (home_source_team_id) home_source_team_id as src, g_home, rg_raw, iso_all
  from _park_pitchlog_2026_raw where home_source_team_id is not null
  order by home_source_team_id, g_home desc nulls last
),
lg as (select avg(rg_raw) rg, avg(iso_all) iso from prim where g_home>=10),
fac as (select p.src, p.g_home, p.rg_raw/lg.rg*100 rg_f, p.iso_all/lg.iso*100 iso_f from prim p cross join lg where p.g_home>=10)
select s.team_name, f.g_home,
  round(f.rg_f::numeric,1) rg_new, round(s.rg_factor_seasonal::numeric,1) rg_tm,
  round(abs(f.rg_f - s.rg_factor_seasonal)::numeric,1) rg_d
from fac f join "Park Factors" s on s.source_team_id=f.src and s.season=2026
order by rg_d desc limit 12;
