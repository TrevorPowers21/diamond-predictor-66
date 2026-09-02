-- WAR C1 pitcher constants → model_config (STAGING). PARITY/REFERENCE with the hitter side.
-- NOTE: unlike the hitter wRC weights, the pitcher pWAR/D1-FIP constants are NOT read from model_config
-- (the edge fn + pitchingEquations.ts carry them as CODE DEFAULTS; the Equation Weights table is empty
-- and no p_*war keys exist). These rows are therefore DERIVED / read-only reference — editing them does
-- NOT change WAR (same status as the owar_* family). Added for both-sided consistency + zero confusion.
-- Canonical: src/lib/pitcherQuality.ts (D1-FIP index) + src/lib/pitchingEquations.ts (pwar_* constants).
-- C1 (2026-08-11):
--   projFIP = 3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9   (lgHBP9 1.467 folded into the intercept)
--   projRA9 = projFIP × E2T 1.137 ;  pRV+ = 100 + 100·(lgRA9 6.913 − projRA9)/lgRA9
--   pWAR    = ((pRV+−100)/100 · IP/9 · 6.915 + IP/9 · 1.92) / 13.1

insert into model_config (model_type, config_key, config_value, season) values
  ('admin_ui', 'pfip_intercept',                '3.847',  2026),  -- 3.10 + 0.509·lgHBP9(1.467)
  ('admin_ui', 'pfip_k9_coef',                  '-0.231', 2026),
  ('admin_ui', 'pfip_bb9_coef',                 '0.509',  2026),
  ('admin_ui', 'pfip_hr9_coef',                 '1.486',  2026),
  ('admin_ui', 'pfip_e2t',                      '1.137',  2026),
  ('admin_ui', 'plg_ra9',                       '6.913',  2026),
  ('admin_ui', 'pwar_r_per_9',                  '6.915',  2026),
  ('admin_ui', 'pwar_replacement_runs_per_9',   '1.92',   2026),
  ('admin_ui', 'pwar_runs_per_win',             '13.1',   2026)
on conflict do nothing;

-- Verify:
--   select config_key, config_value from model_config where season=2026 and (config_key like 'pfip_%' or config_key like 'pwar_%' or config_key like 'plg_%') order by config_key;
