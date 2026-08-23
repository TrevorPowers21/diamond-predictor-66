-- ============================================================================
-- Seed the per-conference PROGRAM TIER MULTIPLIERS (PTM) into model_config (2026-08-23).
-- This is the SINGLE SOURCE read by BOTH write paths (batch precompute-* + the
-- process-precompute-jobs edge fn) via resolveNilTiersFromConfig / buildNilTiers.
-- Keys = `nil_tier_<normalized-conference-code>` (lowercase, non-alphanumerics stripped)
-- + `nil_tier_default` (low-major) + `nil_tier_juco`. Base $/WAR = `nil_base_per_owar` (already 25000).
--
-- ⚠️ MUST RUN BEFORE THE RE-PRICE. The OLD step8 keys are WRONG for the new resolver:
--   - `nil_tier_sec` was 1.5 → the resolver reads it (code "sec" matches) and would OVERRIDE the
--     code default 4.0, silently pricing SEC at 1.5. This seed fixes it to 4.0.
--   - `nil_tier_p4 / nil_tier_big_ten / nil_tier_strong_mid / nil_tier_low_major` use bucket names
--     that no conference code normalizes to → dead. Cleared here.
-- Idempotent: clears all `nil_tier_*` then re-inserts the correct set.
--
-- Reverse-engineered from real roster spend (SEC top ~44 WAR × $25k × 4.0 ≈ $4.4M ≈ ~$100k/win).
-- See docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md. Run staging then prod (paste).
-- ============================================================================

delete from model_config
where config_key like 'nil_tier_%' and model_type = 'admin_ui' and season = 2026;

insert into model_config (model_type, season, config_key, config_value) values
  ('admin_ui', 2026, 'nil_tier_sec',                         '4.0'),
  ('admin_ui', 2026, 'nil_tier_acc',                         '1.5'),
  ('admin_ui', 2026, 'nil_tier_big12',                       '1.2'),
  ('admin_ui', 2026, 'nil_tier_bigten',                      '1.0'),
  ('admin_ui', 2026, 'nil_tier_independent',                 '1.0'),  -- Oregon State etc. (own tier, NOT low-major)
  ('admin_ui', 2026, 'nil_tier_americanathleticconference',  '0.8'),  -- AAC (full-name form in the data)
  ('admin_ui', 2026, 'nil_tier_aac',                         '0.8'),  -- AAC (abbrev form)
  ('admin_ui', 2026, 'nil_tier_sunbelt',                     '0.8'),
  ('admin_ui', 2026, 'nil_tier_bigwest',                     '0.8'),
  ('admin_ui', 2026, 'nil_tier_mountainwest',                '0.8'),
  ('admin_ui', 2026, 'nil_tier_default',                     '0.5'),  -- low-major (any unlisted D1 conf)
  ('admin_ui', 2026, 'nil_tier_juco',                        '0.35'); -- NJCAA districts

-- Verify: select config_key, config_value from model_config
--   where config_key like 'nil_tier_%' and model_type='admin_ui' and season=2026 order by config_key;
-- Base $/WAR (should already exist): select config_value from model_config where config_key='nil_base_per_owar';
