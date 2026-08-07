-- ============================================================================
-- dWAR / bsrWAR data path — new per-season tables (Phase A)
-- TARGET: STAGING (slrxowawbijbjrkozqlj).  NOT prod (trbvxuoliwrfowibatkm).
-- Keyed on players.id (the RSTR IQ uuid); source_player_id (TruMedia id) kept for
-- reference/debug only. Populated by scripts/load-drs-wsb-staging.ts.
-- ============================================================================

-- one row per (player, position, season) — a player who plays multiple positions
-- has multiple rows; the precompute sums their drs_floor into a single d_war.
create table if not exists player_season_defense (
  player_id            uuid not null references players(id),
  source_player_id     text,
  season               int  not null,
  team                 text,
  position             text not null,
  games                int,
  half_innings         int,
  bip_opportunities    numeric,
  bip_faced            numeric,
  tracking_coverage    numeric,
  range_runs           numeric,
  range_gb             numeric,
  range_ld             numeric,
  range_fb             numeric,
  error_runs           numeric,
  dp_runs              numeric,
  arm_runs             numeric,
  framing_runs         numeric,
  blocking_runs        numeric,
  throwing_runs        numeric,
  bunt_runs            numeric,
  drs_total            numeric,
  drs_floor            numeric,   -- regressed; the value used for dWAR
  drs_ceiling          numeric,
  plays_made           int,
  errors               int,
  assists              int,
  putouts              int,
  pop_time_avg         numeric,
  constants_version    text,
  engine_version       text,
  updated_at           timestamptz default now(),
  primary key (player_id, position, season)
);
create index if not exists idx_psd_season on player_season_defense (season);

-- one row per (player, season) — box-score-authoritative counts + wSB run values.
create table if not exists player_season_baserunning (
  player_id            uuid not null references players(id),
  source_player_id     text,   -- = TruMedia playerId
  season               int  not null,
  org_id               text,
  position             text,
  games                int,
  opportunities        numeric,
  sb                   int,
  cs                   int,
  sbh                  int,
  wsb_runs             numeric,
  wsb_runs_reg         numeric,   -- regressed; the value used for bsrWAR
  constants_version    text,
  engine_version       text,
  updated_at           timestamptz default now(),
  primary key (player_id, season)
);
create index if not exists idx_psb_season on player_season_baserunning (season);

-- No RLS: league-wide reference tables read by the precompute (service role bypasses RLS
-- regardless). Add a policy later if a client reads these directly.
