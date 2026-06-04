-- RPC called by the precompute Edge Function after each team run.
-- Refreshes player_snapshot on every team_build_players row that belongs to
-- a build for p_customer_team_id, pulling the freshest precomputed
-- player_predictions row for that team.
--
-- Only touches rows where a matching precomputed row exists — returners that
-- haven't been precomputed yet keep their existing snapshot.

CREATE OR REPLACE FUNCTION public.refresh_build_snapshots_for_team(
  p_customer_team_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.team_build_players tbp
  SET player_snapshot = jsonb_build_object(
    'variant',            pp.variant,
    'model_type',         pp.model_type,
    'customer_team_id',   pp.customer_team_id,
    'class_transition',   pp.class_transition,
    'dev_aggressiveness', pp.dev_aggressiveness,
    'p_avg',              pp.p_avg,
    'p_obp',              pp.p_obp,
    'p_slg',              pp.p_slg,
    'p_iso',              pp.p_iso,
    'p_wrc_plus',         pp.p_wrc_plus,
    'o_war',              pp.o_war,
    'hitter_depth_role',  pp.hitter_depth_role,
    'p_rv_plus',          pp.p_rv_plus,
    'p_era',              pp.p_era,
    'p_fip',              pp.p_fip,
    'p_whip',             pp.p_whip,
    'p_k9',               pp.p_k9,
    'p_bb9',              pp.p_bb9,
    'p_hr9',              pp.p_hr9,
    'p_war',              pp.p_war,
    'pitcher_role',       pp.pitcher_role,
    'market_value',       pp.market_value
  )
  FROM public.team_builds tb
  JOIN public.player_predictions pp
    ON  pp.player_id         = tbp.player_id
    AND pp.customer_team_id  = p_customer_team_id
    AND pp.variant           = 'precomputed'
    AND pp.status            = 'active'
  WHERE tbp.build_id        = tb.id
    AND tb.customer_team_id = p_customer_team_id
    AND tbp.player_id       IS NOT NULL;
$$;
