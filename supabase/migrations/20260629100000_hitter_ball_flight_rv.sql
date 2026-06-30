-- Hitter Ball Flight cross-tabs + Hitter RV components (additive).
-- Populated by the next `aggregate_pitch_log_dimensions` run.
--
-- (1) Direction × trajectory cross-tabs on hitter_totals — Pull/Straight/Oppo
--     split into GB (LA<5) vs Air (LA>=5). batted_pull_air already exists; its
--     aggregation threshold is standardized to LA>=5 in the same run so
--     Pull GB% + Pull Air% = Pull%.
-- (2) RV event-count components on hitter_by_pitch_type so the offense
--     run-value formula (rvOffenseSum) can be computed per pitch type.

alter table public.pitch_log_hitter_totals
  add column if not exists batted_pull_ground   integer not null default 0,
  add column if not exists batted_center_ground integer not null default 0,
  add column if not exists batted_center_air    integer not null default 0,
  add column if not exists batted_oppo_ground   integer not null default 0,
  add column if not exists batted_oppo_air      integer not null default 0;

alter table public.pitch_log_hitter_by_pitch_type
  add column if not exists balls               integer not null default 0,
  add column if not exists called_strikes      integer not null default 0,
  add column if not exists looking_strikeouts  integer not null default 0,
  add column if not exists swinging_strikeouts integer not null default 0;
