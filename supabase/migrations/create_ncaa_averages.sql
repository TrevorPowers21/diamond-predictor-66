-- NCAA averages per season (means + standard deviations)
-- Means are entered manually via the admin form.
-- SDs are auto-calculated from Hitter Master / Pitching Master via refresh_ncaa_sds().

create table if not exists public.ncaa_averages (
  season integer primary key,

  -- Hitter offense (means)
  avg numeric, obp numeric, slg numeric, iso numeric, ops numeric, wrc numeric,
  -- Hitter scouting (means)
  contact_pct numeric, bb_pct numeric, chase_pct numeric, barrel_pct numeric,
  exit_velo numeric, ev90 numeric, ground_pct numeric, pull_pct numeric,
  la_10_30_pct numeric, line_drive_pct numeric, pop_up_pct numeric,
  -- Pitcher results (means)
  era numeric, fip numeric, whip numeric, k9 numeric, bb9 numeric, hr9 numeric,
  -- Pitcher scouting (means)
  pitcher_whiff_pct numeric, pitcher_chase_pct numeric, pitcher_iz_whiff_pct numeric,
  pitcher_bb_pct numeric, pitcher_barrel_pct numeric, pitcher_hard_hit_pct numeric,
  pitcher_ev90 numeric, pitcher_ground_pct numeric, pitcher_pull_pct numeric,
  pitcher_la_10_30_pct numeric, pitcher_line_drive_pct numeric, stuff_plus numeric,

  -- Standard deviations (auto-calculated)
  avg_sd numeric, obp_sd numeric, slg_sd numeric, iso_sd numeric, ops_sd numeric, wrc_sd numeric,
  contact_pct_sd numeric, bb_pct_sd numeric, chase_pct_sd numeric, barrel_pct_sd numeric,
  exit_velo_sd numeric, ev90_sd numeric, ground_pct_sd numeric, pull_pct_sd numeric,
  la_10_30_pct_sd numeric, line_drive_pct_sd numeric, pop_up_pct_sd numeric,
  era_sd numeric, fip_sd numeric, whip_sd numeric, k9_sd numeric, bb9_sd numeric, hr9_sd numeric,
  pitcher_whiff_pct_sd numeric, pitcher_chase_pct_sd numeric, pitcher_iz_whiff_pct_sd numeric,
  pitcher_bb_pct_sd numeric, pitcher_barrel_pct_sd numeric, pitcher_hard_hit_pct_sd numeric,
  pitcher_ev90_sd numeric, pitcher_ground_pct_sd numeric, pitcher_pull_pct_sd numeric,
  pitcher_la_10_30_pct_sd numeric, pitcher_line_drive_pct_sd numeric, stuff_plus_sd numeric,

  updated_at timestamptz default now()
);

alter table public.ncaa_averages enable row level security;

drop policy if exists "anyone can read ncaa averages" on public.ncaa_averages;
drop policy if exists "admin can write ncaa averages" on public.ncaa_averages;

create policy "anyone can read ncaa averages"
  on public.ncaa_averages for select using (true);

create policy "admin can write ncaa averages"
  on public.ncaa_averages for all
  using (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'));

-- Function to refresh SDs for a single season from Hitter Master / Pitching Master
create or replace function public.refresh_ncaa_sds(target_season integer)
returns void language plpgsql security definer as $$
begin
  -- Make sure the row exists
  insert into public.ncaa_averages (season) values (target_season)
  on conflict (season) do nothing;

  update public.ncaa_averages set
    -- Hitter offense SDs
    avg_sd = (select stddev_samp("AVG") from "Hitter Master" where "Season" = target_season and "AVG" is not null),
    obp_sd = (select stddev_samp("OBP") from "Hitter Master" where "Season" = target_season and "OBP" is not null),
    slg_sd = (select stddev_samp("SLG") from "Hitter Master" where "Season" = target_season and "SLG" is not null),
    iso_sd = (select stddev_samp("ISO") from "Hitter Master" where "Season" = target_season and "ISO" is not null),
    -- Hitter scouting SDs (raw metric columns are lowercase in Hitter Master)
    contact_pct_sd = (select stddev_samp(contact) from "Hitter Master" where "Season" = target_season and contact is not null),
    bb_pct_sd = (select stddev_samp(bb) from "Hitter Master" where "Season" = target_season and bb is not null),
    chase_pct_sd = (select stddev_samp(chase) from "Hitter Master" where "Season" = target_season and chase is not null),
    barrel_pct_sd = (select stddev_samp(barrel) from "Hitter Master" where "Season" = target_season and barrel is not null),
    exit_velo_sd = (select stddev_samp(avg_exit_velo) from "Hitter Master" where "Season" = target_season and avg_exit_velo is not null),
    ev90_sd = (select stddev_samp(ev90) from "Hitter Master" where "Season" = target_season and ev90 is not null),
    ground_pct_sd = (select stddev_samp(gb) from "Hitter Master" where "Season" = target_season and gb is not null),
    pull_pct_sd = (select stddev_samp(pull) from "Hitter Master" where "Season" = target_season and pull is not null),
    la_10_30_pct_sd = (select stddev_samp(la_10_30) from "Hitter Master" where "Season" = target_season and la_10_30 is not null),
    line_drive_pct_sd = (select stddev_samp(line_drive) from "Hitter Master" where "Season" = target_season and line_drive is not null),
    pop_up_pct_sd = (select stddev_samp(pop_up) from "Hitter Master" where "Season" = target_season and pop_up is not null),

    -- Pitcher results SDs
    era_sd = (select stddev_samp("ERA") from "Pitching Master" where "Season" = target_season and "ERA" is not null),
    fip_sd = (select stddev_samp("FIP") from "Pitching Master" where "Season" = target_season and "FIP" is not null),
    whip_sd = (select stddev_samp("WHIP") from "Pitching Master" where "Season" = target_season and "WHIP" is not null),
    k9_sd = (select stddev_samp("K9") from "Pitching Master" where "Season" = target_season and "K9" is not null),
    bb9_sd = (select stddev_samp("BB9") from "Pitching Master" where "Season" = target_season and "BB9" is not null),
    hr9_sd = (select stddev_samp("HR9") from "Pitching Master" where "Season" = target_season and "HR9" is not null),
    -- Pitcher scouting SDs
    pitcher_whiff_pct_sd = (select stddev_samp(miss_pct) from "Pitching Master" where "Season" = target_season and miss_pct is not null),
    pitcher_chase_pct_sd = (select stddev_samp(chase_pct) from "Pitching Master" where "Season" = target_season and chase_pct is not null),
    pitcher_iz_whiff_pct_sd = (select stddev_samp(in_zone_whiff_pct) from "Pitching Master" where "Season" = target_season and in_zone_whiff_pct is not null),
    pitcher_bb_pct_sd = (select stddev_samp(bb_pct) from "Pitching Master" where "Season" = target_season and bb_pct is not null),
    pitcher_barrel_pct_sd = (select stddev_samp(barrel_pct) from "Pitching Master" where "Season" = target_season and barrel_pct is not null),
    pitcher_hard_hit_pct_sd = (select stddev_samp(hard_hit_pct) from "Pitching Master" where "Season" = target_season and hard_hit_pct is not null),
    pitcher_ev90_sd = (select stddev_samp("90th_vel") from "Pitching Master" where "Season" = target_season and "90th_vel" is not null),
    pitcher_ground_pct_sd = (select stddev_samp(ground_pct) from "Pitching Master" where "Season" = target_season and ground_pct is not null),
    pitcher_pull_pct_sd = (select stddev_samp(h_pull_pct) from "Pitching Master" where "Season" = target_season and h_pull_pct is not null),
    pitcher_la_10_30_pct_sd = (select stddev_samp(la_10_30_pct) from "Pitching Master" where "Season" = target_season and la_10_30_pct is not null),
    pitcher_line_drive_pct_sd = (select stddev_samp(line_pct) from "Pitching Master" where "Season" = target_season and line_pct is not null),
    stuff_plus_sd = (select stddev_samp(stuff_plus) from "Pitching Master" where "Season" = target_season and stuff_plus is not null),

    updated_at = now()
  where season = target_season;
end;
$$;

-- Refresh all seasons that have data
create or replace function public.refresh_ncaa_sds_all()
returns void language plpgsql security definer as $$
declare
  s integer;
begin
  for s in
    select distinct "Season" from "Hitter Master" where "Season" is not null
    union
    select distinct "Season" from "Pitching Master" where "Season" is not null
  loop
    perform public.refresh_ncaa_sds(s);
  end loop;
end;
$$;
