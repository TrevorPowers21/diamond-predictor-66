with lg as (
  select avg(rg_raw) rg, avg(avg_all) avg, avg(obp_all) obp, avg(iso_all) iso
  from _park_home_2026 where home_games >= 15
),
fac as (
  select p.team, p.home_games,
    p.rg_raw/lg.rg*100 rg_f, p.avg_all/lg.avg*100 avg_f, p.obp_all/lg.obp*100 obp_f, p.iso_all/lg.iso*100 iso_f
  from _park_home_2026 p cross join lg where p.home_games >= 15
)
select count(*) n,
  round(avg(abs(f.avg_f - s.avg_factor_seasonal))::numeric,2) avg_mad,
  round(avg(abs(f.obp_f - s.obp_factor_seasonal))::numeric,2) obp_mad,
  round(avg(abs(f.iso_f - s.iso_factor_seasonal))::numeric,2) iso_mad,
  round(avg(abs(f.rg_f  - s.rg_factor_seasonal ))::numeric,2) rg_mad,
  round(corr(f.iso_f, s.iso_factor_seasonal)::numeric,3) iso_corr,
  round(corr(f.rg_f,  s.rg_factor_seasonal )::numeric,3) rg_corr,
  round(corr(f.avg_f, s.avg_factor_seasonal)::numeric,3) avg_corr
from fac f join "Park Factors" s on s.source_team_id=f.team and s.season=2026;
