-- team_season_stats — canonical per-team-per-season table (the team-stats layer).
-- Key (source_id, season). source_id = STABLE program id; team_season_id = per-season "Teams Table".id.
-- Written automatically by the ONE edge fn. Build rule: team = Σ player values.
-- WARs stored _reg (regular season) + _total (incl postseason), boundary 2026-05-18.
-- Design + sources: docs/HANDOFF_team_season_stats_2026_08_19.md.

CREATE TABLE IF NOT EXISTS public.team_season_stats (
  -- ── keys ──────────────────────────────────────────────────────────────
  source_id        text        NOT NULL,   -- program (stable across seasons)
  season           integer     NOT NULL,
  team_season_id   uuid,                    -- "Teams Table".id (per-season)
  conference_id    uuid,
  team_name        text,
  abbreviation     text,

  -- ── WAR matrix (Σ player WAR), reg + total ────────────────────────────
  owar_reg         double precision, owar_total       double precision,
  dwar_reg         double precision, dwar_total        double precision,
  bsrwar_reg       double precision, bsrwar_total      double precision,
  pwar_reg         double precision, pwar_total        double precision,
  total_war_reg    double precision, total_war_total   double precision,

  -- ── carried from team_war_snapshots (migrate; preserve champions) ─────
  proration_factor    double precision,
  games_played_est    double precision,
  n_hitters           integer,
  n_pitchers          integer,
  team_drs            double precision,
  is_national_champ   boolean DEFAULT false,
  is_conference_champ boolean DEFAULT false,
  national_seed_rank  integer,

  -- ── hitting counting (Σ), reg + total ─────────────────────────────────
  pa_reg  integer, pa_total  integer,
  ab_reg  integer, ab_total  integer,
  h_reg   integer, h_total   integer,
  dbl_reg integer, dbl_total integer,
  tpl_reg integer, tpl_total integer,
  hr_reg  integer, hr_total  integer,
  bb_reg  integer, bb_total  integer,
  hbp_reg integer, hbp_total integer,
  k_reg   integer, k_total   integer,
  sb_reg  integer, sb_total  integer,
  cs_reg  integer, cs_total  integer,
  sf_reg  integer, sf_total  integer,

  -- ── hitting rates (derived from the sums), reg + total ────────────────
  avg_reg  double precision, avg_total  double precision,
  obp_reg  double precision, obp_total  double precision,
  slg_reg  double precision, slg_total  double precision,
  iso_reg  double precision, iso_total  double precision,
  ops_reg  double precision, ops_total  double precision,
  wrc_plus_reg double precision, wrc_plus_total double precision,

  -- ── pitching counting (Σ), reg + total ────────────────────────────────
  ip_reg   double precision, ip_total   double precision,
  outs_reg integer, outs_total integer,
  bf_reg   integer, bf_total   integer,
  pk_reg   integer, pk_total   integer,   -- pitching strikeouts
  pbb_reg  integer, pbb_total  integer,
  phbp_reg integer, phbp_total integer,
  phr_reg  integer, phr_total  integer,
  ph_reg   integer, ph_total   integer,   -- hits allowed
  er_reg   integer, er_total   integer,

  -- ── pitching rates (derived), reg + total ─────────────────────────────
  era_reg  double precision, era_total  double precision,
  fip_reg  double precision, fip_total  double precision,
  whip_reg double precision, whip_total double precision,
  k9_reg   double precision, k9_total   double precision,
  bb9_reg  double precision, bb9_total  double precision,
  hr9_reg  double precision, hr9_total  double precision,

  -- ── records (new run from pitch_log game outcomes) ────────────────────
  w_reg  integer, l_reg  integer,
  w_total integer, l_total integer,
  w_conf integer, l_conf integer,
  wins_over_proj double precision,          -- future: actual vs projected-from-WAR

  -- ── conference-scoped context (migrate from "Conference Stats" via conference_id) ─
  conf_stuff_plus  double precision,
  conf_htp         double precision,        -- hitter_talent_plus
  run_env_factor   double precision,
  conf_opr         double precision,        -- Overall_Power_Rating
  conf_wrc_plus    double precision,

  -- ── team intra-conference rate line (team's conf-vs-conf, pitch_log filtered) ──
  team_conf_avg double precision, team_conf_obp double precision, team_conf_slg double precision,
  team_conf_era double precision, team_conf_fip double precision,

  -- ── competition faced (schedule-weighted opp-conf metric) ─────────────
  faced_stuff_plus double precision,
  faced_htp        double precision,

  -- ── park snapshot (from "Park Factors"; that table stays historical source) ──
  park_rg_rolling  double precision, park_rg_single  double precision,
  park_avg_rolling double precision, park_avg_single double precision,
  park_hr9_rolling double precision, park_hr9_single double precision,

  -- ── meta ──────────────────────────────────────────────────────────────
  notes       text,
  computed_at timestamptz DEFAULT now(),

  CONSTRAINT team_season_stats_pkey PRIMARY KEY (source_id, season)
);

CREATE INDEX IF NOT EXISTS team_season_stats_season_idx      ON public.team_season_stats (season);
CREATE INDEX IF NOT EXISTS team_season_stats_conference_idx  ON public.team_season_stats (conference_id);
CREATE INDEX IF NOT EXISTS team_season_stats_team_season_idx ON public.team_season_stats (team_season_id);

-- service-role-only (pipeline table); no anon/auth policies
ALTER TABLE public.team_season_stats ENABLE ROW LEVEL SECURITY;
