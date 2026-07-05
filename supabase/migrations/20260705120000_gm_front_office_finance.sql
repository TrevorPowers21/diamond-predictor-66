-- Front Office (GM) money + eligibility, Path A. Keyed by (customer_team_id,
-- player_id, season) so it is year-specific and RLS-scoped like team_market_pay_log.
-- Actual Pay is the source of truth here; on Finalize it syncs to the coach's
-- team_build_players.nil_value. Buckets (rev/nil/other) are INDEPENDENT and do
-- NOT auto-sum into actual_pay (spec §4).

CREATE TABLE IF NOT EXISTS public.gm_player_finance (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id            uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id                   uuid NOT NULL,
  season                      integer NOT NULL,
  rev_share                   numeric,
  nil_amount                  numeric,
  other_amount                numeric,
  actual_pay                  numeric,
  finalized                   boolean NOT NULL DEFAULT false,
  finalized_at                timestamptz,
  -- eligibility (GM/head-coach editable, stored) — year-in-school override on
  -- top of players.class_year (GR is a normal ongoing class, not exhausted).
  -- Draft year lives on the player profile, NOT here.
  eligibility_class           text,
  eligibility_note            text,
  updated_by_user_id          uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, player_id, season)
);
CREATE INDEX IF NOT EXISTS idx_gm_player_finance_team_season
  ON public.gm_player_finance (customer_team_id, season);

-- Per-team, per-season budget allotments per bucket (set via the header editor).
CREATE TABLE IF NOT EXISTS public.gm_budget (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  season             integer NOT NULL,
  rev_share_total    numeric,
  nil_total          numeric,
  other_total        numeric,
  finalized          boolean NOT NULL DEFAULT false,
  finalized_at       timestamptz,
  updated_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, season)
);

ALTER TABLE public.gm_player_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_budget ENABLE ROW LEVEL SECURITY;

-- superadmin OR member of the row's customer_team (same pattern as target_board).
DROP POLICY IF EXISTS gm_player_finance_all ON public.gm_player_finance;
CREATE POLICY gm_player_finance_all ON public.gm_player_finance
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

DROP POLICY IF EXISTS gm_budget_all ON public.gm_budget;
CREATE POLICY gm_budget_all ON public.gm_budget
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));
