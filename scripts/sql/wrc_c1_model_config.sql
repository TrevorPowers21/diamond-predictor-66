-- WAR C1 — sync model_config + ncaa_averages to the C1 wRC+/oWAR constants (STAGING first).
-- The config-driven read paths (precompute edge fn, predictionEngine, TeamBuilder sim) read these keys;
-- the DB currently holds OLD values that would OVERRIDE the C1 code defaults, so this must run BEFORE the
-- Step-6 re-precompute or the pipeline produces old wRC+.
-- C1: wRC+ = (0.011 + 0.691·OBP + 0.235·SLG) ÷ 0.3782 × 100 ; oWAR RUNS_PER_PA 0.3994, RPW 13.1, repl 26.2.

-- ── wRC+ weights (returner + transfer): AVG/ISO redundant → 0 ────────────────
update model_config set config_value = '0.691'  where season = 2026 and config_key = 'r_w_obp';
update model_config set config_value = '0.235'  where season = 2026 and config_key = 'r_w_slg';
update model_config set config_value = '0'      where season = 2026 and config_key = 'r_w_avg';
update model_config set config_value = '0'      where season = 2026 and config_key = 'r_w_iso';
update model_config set config_value = '0.691'  where season = 2026 and config_key = 't_w_obp';
update model_config set config_value = '0.235'  where season = 2026 and config_key = 't_w_slg';
update model_config set config_value = '0'      where season = 2026 and config_key = 't_w_avg';
update model_config set config_value = '0'      where season = 2026 and config_key = 't_w_iso';

-- ── wRC+ denominator → lgwOBA 0.3782 ────────────────────────────────────────
update model_config set config_value = '0.3782' where season = 2026 and config_key = 'r_ncaa_avg_wrc';
-- ⚠ VERIFY: the transfer denom the engine actually reads. DB has `t_wrc_plus_ncaa_avg = 1` (odd — a
-- multiplier, not 0.364) and code reads `t_wrc_ncaa_avg` (absent → code default 0.3782 applies). Confirm
-- which key the transfer path consumes before trusting the transfer wRC+; leave `t_wrc_plus_ncaa_avg` unless
-- verified to be the denom.

-- ── new intercept keys (0.011) — did not exist ─────────────────────────────
-- (adjust columns if the table requires an explicit id/created_at)
insert into model_config (model_type, config_key, config_value, season)
values ('admin_ui', 'r_w_intercept', '0.011', 2026),
       ('admin_ui', 't_w_intercept', '0.011', 2026)
on conflict do nothing;

-- ── oWAR constants (DEAD — not read by the computation — but keep consistent; DB was pre-reconcile stale) ──
update model_config set config_value = '0.3994' where season = 2026 and config_key = 'owar_run_value_per_pa';
update model_config set config_value = '13.1'   where season = 2026 and config_key = 'owar_runs_per_win';
update model_config set config_value = '26.2'   where season = 2026 and config_key = 'owar_replacement_runs_per_600';

-- ── HistoricalPlayerTable wRC+ denominator source (was null) ────────────────
update ncaa_averages set wrc = 0.3782 where season = 2026;

-- Verify:
--   select config_key, config_value from model_config where season=2026 and (config_key like '%w_%' or config_key like '%wrc%' or config_key like 'owar_%') order by config_key;
--   select season, wrc from ncaa_averages where season=2026;
