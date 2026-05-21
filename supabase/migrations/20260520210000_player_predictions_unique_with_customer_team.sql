-- Eager Transfer Pre-compute — UPSERT key
--
-- The existing unique constraint
--   (player_id, model_type, variant, season)
-- pre-dates customer_team_id. With team-scoped rows now possible, we need
-- (player_id, customer_team_id, model_type, variant, season) so that:
--   * A global (customer_team_id IS NULL) row can coexist with team rows
--   * Each (player, team) pair is unique per model/variant/season → safe UPSERT
--
-- NULLS NOT DISTINCT means a single global row per player/model/variant/season
-- (otherwise NULL customer_team_id would let duplicates accumulate).

-- Drop old constraint (Postgres auto-created the index from the UNIQUE constraint)
ALTER TABLE public.player_predictions
  DROP CONSTRAINT IF EXISTS player_predictions_player_id_model_type_variant_season_key;

-- New unique constraint including customer_team_id, NULLS NOT DISTINCT
ALTER TABLE public.player_predictions
  ADD CONSTRAINT player_predictions_player_team_model_variant_season_key
  UNIQUE NULLS NOT DISTINCT (player_id, customer_team_id, model_type, variant, season);
