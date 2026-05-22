-- platform_config: runtime-adjustable platform-wide constants.
--
-- Admins can update any key here without a code deployment.
-- The usePlatformConfig() hook merges these rows on top of the TypeScript
-- defaults in src/lib/config/platformDefaults.ts — so missing keys always
-- fall back to the TS constant, and DB rows only exist for values that have
-- been intentionally overridden.
--
-- Row structure:
--   config_key   — dot-separated path matching the constant group, e.g.
--                  "nil.sec_tier_multiplier" or "juco.regression.avg.maxR"
--   config_value — JSONB so numbers, strings, objects, and arrays all fit
--   description  — plain-English note for the admin UI
--   updated_at   — for audit / cache-busting

create table if not exists platform_config (
  id            uuid primary key default gen_random_uuid(),
  config_key    text not null unique,
  config_value  jsonb not null,
  description   text,
  updated_at    timestamptz not null default now()
);

-- Only superadmins can write; all authenticated users can read.
alter table platform_config enable row level security;

create policy "superadmin write platform_config"
  on platform_config for all
  using (
    exists (
      select 1 from user_roles
      where user_id = auth.uid() and role = 'superadmin'
    )
  );

create policy "authenticated read platform_config"
  on platform_config for select
  using (auth.role() = 'authenticated');

-- Trigger to keep updated_at fresh.
create or replace function set_platform_config_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger platform_config_updated_at
  before update on platform_config
  for each row execute function set_platform_config_updated_at();

-- Seed the initial overrideable defaults (mirrors platformDefaults.ts).
-- These rows document what exists; callers fall back to TS defaults when
-- the row is absent, so seeding is optional but makes the admin UI useful.
insert into platform_config (config_key, config_value, description) values
  ('nil.tier.sec',        '1.5',  'NIL conference-tier multiplier — SEC'),
  ('nil.tier.p4',         '1.2',  'NIL conference-tier multiplier — ACC + Big 12'),
  ('nil.tier.big_ten',    '1.0',  'NIL conference-tier multiplier — Big Ten'),
  ('nil.tier.strong_mid', '0.8',  'NIL conference-tier multiplier — AAC, Sun Belt, Big West, Mountain West'),
  ('nil.tier.low_major',  '0.5',  'NIL conference-tier multiplier — all other conferences'),
  ('nil.default_program_total_player_score', '68', 'Denominator for NIL allocation on partial rosters'),
  ('transfer.d1.conference.avg', '0.30', 'D1 transfer: conference weight for AVG'),
  ('transfer.d1.conference.obp', '0.30', 'D1 transfer: conference weight for OBP'),
  ('transfer.d1.conference.iso', '0.15', 'D1 transfer: conference weight for ISO'),
  ('transfer.d1.pitching.avg',   '1.00', 'D1 transfer: Stuff+ weight for AVG'),
  ('transfer.d1.pitching.obp',   '0.85', 'D1 transfer: Stuff+ weight for OBP'),
  ('transfer.d1.pitching.iso',   '0.75', 'D1 transfer: Stuff+ weight for ISO'),
  ('transfer.d1.park.avg',       '0.24', 'D1 transfer: park factor weight for AVG'),
  ('transfer.d1.park.obp',       '0.26', 'D1 transfer: park factor weight for OBP'),
  ('transfer.d1.park.iso',       '0.11', 'D1 transfer: park factor weight for ISO'),
  ('transfer.d1.power_blend',    '0.70', 'D1 transfer: power-rating blend fraction'),
  ('transfer.juco.conference.avg', '0.42', 'JUCO transfer: conference weight for AVG'),
  ('transfer.juco.conference.obp', '0.43', 'JUCO transfer: conference weight for OBP'),
  ('transfer.juco.conference.iso', '0.20', 'JUCO transfer: conference weight for ISO'),
  ('transfer.juco.pitching.avg',   '1.30', 'JUCO transfer: Stuff+ weight for AVG'),
  ('transfer.juco.pitching.obp',   '1.13', 'JUCO transfer: Stuff+ weight for OBP'),
  ('transfer.juco.pitching.iso',   '0.92', 'JUCO transfer: Stuff+ weight for ISO'),
  ('juco.regression.avg.threshold', '0.350', 'JUCO outlier regression: AVG outlier threshold'),
  ('juco.regression.avg.slope',     '1.12',  'JUCO outlier regression: AVG regression slope'),
  ('juco.regression.avg.maxR',      '0.10',  'JUCO outlier regression: AVG max regression fraction'),
  ('juco.regression.obp.threshold', '0.450', 'JUCO outlier regression: OBP outlier threshold'),
  ('juco.regression.obp.slope',     '0.85',  'JUCO outlier regression: OBP regression slope'),
  ('juco.regression.obp.maxR',      '0.10',  'JUCO outlier regression: OBP max regression fraction'),
  ('juco.regression.iso.threshold', '0.280', 'JUCO outlier regression: ISO outlier threshold'),
  ('juco.regression.iso.slope',     '1.50',  'JUCO outlier regression: ISO regression slope'),
  ('juco.regression.iso.maxR',      '0.15',  'JUCO outlier regression: ISO max regression fraction')
on conflict (config_key) do nothing;
