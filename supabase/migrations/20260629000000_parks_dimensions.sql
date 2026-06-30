-- Park-aware HR system: SHARED physical park dimensions.
--
-- Distinct from `park_factors` (a run-environment MULTIPLIER, no geometry).
-- Read-only to tenants, service-role / superadmin write (mirrors the
-- park_factors / "Teams Table" shared-reference RLS pattern).
--
-- Column order matches the parks CSV so the dashboard import maps positionally.
-- `team_id` joins to "Teams Table" so a customer's park resolves through
-- customer_teams.school_team_id (no separate `programs` table needed — that
-- role is already played by "Teams Table").

create table if not exists public.parks (
  slug          text primary key,
  program       text not null,
  conference    text,
  stadium       text,
  lf_line       int,
  lf_gap        int,
  lc            int,
  cf            int,
  rc            int,
  rf_gap        int,
  rf_line       int,
  wall_ht_ft    int default 8,
  outfield_sqft int,
  altitude_ft   int,
  team_id       uuid references public."Teams Table"(id),
  created_at    timestamptz default now()
);

create index if not exists idx_parks_team_id on public.parks(team_id);

alter table public.parks enable row level security;

drop policy if exists "parks_read" on public.parks;
create policy "parks_read" on public.parks
  for select to authenticated using (true);

drop policy if exists "parks_modify" on public.parks;
create policy "parks_modify" on public.parks
  for all to authenticated
  using (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role));
