-- 2026-06-18 — Market Pay Log feature
--
-- Per-team coach-logged market pay observations for players. Coaches log
-- reported NIL deals they hear via word of mouth (e.g., "I heard Jaxon
-- Shineflew got $80k at his new school"). Each row is private to one team
-- via RLS, gated behind a per-team feature flag so other customer teams
-- don't see the feature until opted in.
--
-- Georgia Bulldogs is the initial pilot. Other teams flip on via UPDATE
-- of customer_teams.market_pay_enabled.
--
-- Future use: superadmin aggregates entries across teams to recalibrate
-- the market_value equation against real word-of-mouth NIL data.
--
-- Storage model: one row per (customer_team_id, player_id, season).
-- Last-write-wins via upsert on the unique constraint. The same player
-- can have separate entries per team (Georgia and Arkansas may each log
-- their own number for the same player — both are word-of-mouth, no
-- canonical truth).

-- 1. Feature flag on customer_teams. Gates all access regardless of role.
ALTER TABLE public.customer_teams
  ADD COLUMN IF NOT EXISTS market_pay_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customer_teams.market_pay_enabled IS
  'When true, this team''s coaches can use the Market Pay Log feature on Player Profile. Set true for Georgia Bulldogs 2026-06-18 as initial pilot.';

-- 2. Main log table
CREATE TABLE IF NOT EXISTS public.team_market_pay_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season integer NOT NULL,
  market_pay_amount numeric,        -- nullable; notes-only entries allowed
  notes text,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (customer_team_id, player_id, season)
);

COMMENT ON TABLE public.team_market_pay_log IS
  'Per-team coach-logged market pay observations for players (NIL amounts heard via word of mouth). One row per (team, player, season). Multiple teams can log the same player independently — each row protected by RLS, with superadmin override for cross-team research.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_market_pay_log_team_player
  ON public.team_market_pay_log(customer_team_id, player_id);
CREATE INDEX IF NOT EXISTS idx_market_pay_log_player_season
  ON public.team_market_pay_log(player_id, season);

-- 3. Auto-touch updated_at on edit
CREATE OR REPLACE FUNCTION public.fn_market_pay_log_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_pay_log_touch_updated_at ON public.team_market_pay_log;
CREATE TRIGGER market_pay_log_touch_updated_at
  BEFORE UPDATE ON public.team_market_pay_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_market_pay_log_touch_updated_at();

-- 4. RLS — superadmin sees all; team members see their team's rows if their
-- team has the feature enabled. Uses existing has_role + is_team_member
-- helpers from 20260428200000_rls_helper_functions.sql.
ALTER TABLE public.team_market_pay_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_pay_log_select ON public.team_market_pay_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.is_team_member(team_market_pay_log.customer_team_id)
      AND EXISTS (
        SELECT 1 FROM public.customer_teams ct
        WHERE ct.id = team_market_pay_log.customer_team_id
          AND ct.market_pay_enabled = true
      )
    )
  );

CREATE POLICY market_pay_log_insert ON public.team_market_pay_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.is_team_member(team_market_pay_log.customer_team_id)
      AND EXISTS (
        SELECT 1 FROM public.customer_teams ct
        WHERE ct.id = team_market_pay_log.customer_team_id
          AND ct.market_pay_enabled = true
      )
    )
  );

CREATE POLICY market_pay_log_update ON public.team_market_pay_log
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.is_team_member(team_market_pay_log.customer_team_id)
      AND EXISTS (
        SELECT 1 FROM public.customer_teams ct
        WHERE ct.id = team_market_pay_log.customer_team_id
          AND ct.market_pay_enabled = true
      )
    )
  );

CREATE POLICY market_pay_log_delete ON public.team_market_pay_log
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (
      public.is_team_member(team_market_pay_log.customer_team_id)
      AND EXISTS (
        SELECT 1 FROM public.customer_teams ct
        WHERE ct.id = team_market_pay_log.customer_team_id
          AND ct.market_pay_enabled = true
      )
    )
  );

-- 5. Enable Georgia Bulldogs as the pilot team
UPDATE public.customer_teams
  SET market_pay_enabled = true
  WHERE name = 'Georgia Bulldogs';
