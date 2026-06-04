-- RPC called by the precompute Edge Function after each team run.
-- Refreshes player_snapshot with FINAL values — the same numbers the coach
-- sees — so builds load with zero client-side computation.
--
-- Applies the coach's depth-role and devAgg settings (stored in
-- production_notes JSON) to the fresh precomputed base values, producing the
-- same overlay the client would compute. Snapshot stores these final values
-- plus the coach settings as the new baseline (overlay = 1 on next load).
--
-- PA lookup for hitter depth roles (matches paForHitterDepthRole in JS):
--   cornerstone=245, everyday_starter=215, platoon_starter=145,
--   utility=85, bench=25, default=215
--
-- Only touches rows where a matching precomputed row exists.

CREATE OR REPLACE FUNCTION public.refresh_build_snapshots_for_team(
  p_customer_team_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
  coach_depth_role text;
  coach_dev_agg    numeric;
  stored_depth_role text;
  stored_dev_agg   numeric;
  stored_pa        numeric;
  coach_pa         numeric;
  class_adj        numeric;
  stored_mult      numeric;
  coach_mult       numeric;
  depth_scale      numeric;
  dev_scale        numeric;
  overlay          numeric;
BEGIN
  FOR r IN
    SELECT
      tbp.id          AS tbp_id,
      tbp.production_notes,
      pp.p_avg, pp.p_obp, pp.p_slg, pp.p_iso, pp.p_wrc_plus,
      pp.o_war, pp.market_value, pp.hitter_depth_role,
      pp.dev_aggressiveness AS base_dev_agg,
      pp.p_rv_plus, pp.p_era, pp.p_fip, pp.p_whip,
      pp.p_k9, pp.p_bb9, pp.p_hr9, pp.p_war,
      pp.pitcher_role, pp.variant, pp.model_type,
      pp.customer_team_id, pp.class_transition
    FROM public.team_build_players tbp
    JOIN public.team_builds tb ON tb.id = tbp.build_id
    JOIN public.player_predictions pp
      ON  pp.player_id        = tbp.player_id
      AND pp.customer_team_id = p_customer_team_id
      AND pp.variant          = 'precomputed'
      AND pp.status           = 'active'
    WHERE tb.customer_team_id = p_customer_team_id
      AND tbp.player_id IS NOT NULL
  LOOP
    -- Read coach settings from production_notes JSON
    coach_depth_role := r.production_notes::jsonb ->> 'depthRole';
    coach_dev_agg    := COALESCE((r.production_notes::jsonb ->> 'devAggressiveness')::numeric, 0);
    stored_depth_role := COALESCE(r.hitter_depth_role, 'everyday_starter');
    stored_dev_agg    := COALESCE(r.base_dev_agg, 0);

    -- PA by depth role (matches paForHitterDepthRole)
    stored_pa := CASE stored_depth_role
      WHEN 'cornerstone'      THEN 245
      WHEN 'everyday_starter' THEN 215
      WHEN 'starter'          THEN 215
      WHEN 'platoon_starter'  THEN 145
      WHEN 'utility'          THEN 85
      WHEN 'bench'            THEN 25
      ELSE 215
    END;
    coach_pa := CASE COALESCE(coach_depth_role, stored_depth_role)
      WHEN 'cornerstone'      THEN 245
      WHEN 'everyday_starter' THEN 215
      WHEN 'starter'          THEN 215
      WHEN 'platoon_starter'  THEN 145
      WHEN 'utility'          THEN 85
      WHEN 'bench'            THEN 25
      ELSE 215
    END;

    -- Class adj for devAgg (SJ=0.02, FS=0.03, GR=0.01)
    class_adj := CASE COALESCE(r.class_transition, 'SJ')
      WHEN 'FS' THEN 0.03
      WHEN 'GR' THEN 0.01
      ELSE 0.02
    END;

    -- Depth overlay: PA ratio (exact — oWAR is linear in PA at fixed wRC+)
    depth_scale := CASE WHEN stored_pa > 0 THEN coach_pa / stored_pa ELSE 1 END;

    -- DevAgg overlay: multiplier ratio
    stored_mult := 1 + class_adj + stored_dev_agg * 0.06;
    coach_mult  := 1 + class_adj + coach_dev_agg  * 0.06;
    dev_scale   := CASE WHEN stored_mult > 0 THEN coach_mult / stored_mult ELSE 1 END;
    overlay     := depth_scale * dev_scale;

    UPDATE public.team_build_players
    SET player_snapshot = jsonb_build_object(
      -- Hitter stats with devAgg applied
      'p_avg',       r.p_avg       * dev_scale,
      'p_obp',       r.p_obp       * dev_scale,
      'p_slg',       r.p_slg       * dev_scale,
      'p_iso',       r.p_iso       * dev_scale,
      'p_wrc_plus',  ROUND(r.p_wrc_plus * dev_scale),
      -- oWAR and market_value with full overlay
      'o_war',        r.o_war       * overlay,
      'market_value', r.market_value * overlay,
      -- Pitcher stats (devAgg only — pitcher depth role handled via p_war)
      'p_rv_plus',   r.p_rv_plus,
      'p_era',       r.p_era,
      'p_fip',       r.p_fip,
      'p_whip',      r.p_whip,
      'p_k9',        r.p_k9,
      'p_bb9',       r.p_bb9,
      'p_hr9',       r.p_hr9,
      'p_war',       r.p_war,
      'pitcher_role', r.pitcher_role,
      -- Coach settings as new baseline — overlay = 1 on next client load
      'hitter_depth_role',  COALESCE(coach_depth_role, stored_depth_role),
      'dev_aggressiveness', coach_dev_agg,
      -- Identity metadata
      'variant',          r.variant,
      'model_type',       r.model_type,
      'customer_team_id', r.customer_team_id,
      'class_transition', r.class_transition
    )
    WHERE id = r.tbp_id;
  END LOOP;
END;
$$;
