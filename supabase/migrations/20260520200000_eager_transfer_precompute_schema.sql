-- Eager Transfer Pre-compute — schema foundation
--
-- Adds:
--   1. customer_team_id on player_predictions (nullable; null = global/universal row).
--      Pre-computed transfer projections for a specific customer team get this
--      set. Global returner / "no customer" rows leave it null.
--   2. customer_team_equation_overrides — per-team tuning of equation_weights /
--      model_config keys. Read path layers overrides on top of globals at
--      compute time.
--   3. Indexes + RLS.
--
-- Read pattern (handled in code):
--   prefer (player_id, customer_team_id, model_type='transfer', status='active')
--   fall back to (player_id, customer_team_id IS NULL, model_type='returner', status='active')

-- ============================================================================
-- 1. player_predictions.customer_team_id
-- ============================================================================
ALTER TABLE public.player_predictions
  ADD COLUMN IF NOT EXISTS customer_team_id uuid REFERENCES public.customer_teams(id) ON DELETE CASCADE;

-- Lookup index for the read-path: (player_id, customer_team_id, model_type)
CREATE INDEX IF NOT EXISTS idx_player_predictions_player_team_model
  ON public.player_predictions(player_id, customer_team_id, model_type)
  WHERE status = 'active';

-- Index to support batch deletes when re-running pre-compute for a team
CREATE INDEX IF NOT EXISTS idx_player_predictions_customer_team
  ON public.player_predictions(customer_team_id)
  WHERE customer_team_id IS NOT NULL;

-- ============================================================================
-- 2. customer_team_equation_overrides
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customer_team_equation_overrides (
  customer_team_id uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  model_type       text NOT NULL,
  config_key       text NOT NULL,
  config_value     numeric NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id),
  PRIMARY KEY (customer_team_id, model_type, config_key)
);

CREATE INDEX IF NOT EXISTS idx_cte_overrides_team
  ON public.customer_team_equation_overrides(customer_team_id);

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.touch_cte_overrides_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cte_overrides_updated_at ON public.customer_team_equation_overrides;
CREATE TRIGGER trg_cte_overrides_updated_at
  BEFORE UPDATE ON public.customer_team_equation_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_cte_overrides_updated_at();

-- ============================================================================
-- 3. RLS on customer_team_equation_overrides
-- ============================================================================
ALTER TABLE public.customer_team_equation_overrides ENABLE ROW LEVEL SECURITY;

-- Read: superadmin OR team member
CREATE POLICY "Team members read equation overrides"
  ON public.customer_team_equation_overrides FOR SELECT
  USING (
    (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role))
    OR public.is_team_member(customer_team_id)
  );

-- Write: superadmin only in v1. Team admin self-service is a future v2.
CREATE POLICY "Superadmin manages equation overrides"
  ON public.customer_team_equation_overrides FOR ALL
  USING ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role)))
  WITH CHECK ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'staff'::app_role)));

-- ============================================================================
-- 4. RLS additions on player_predictions for customer-scoped rows
-- ============================================================================
-- Existing policy "Authenticated users can read player_predictions" stays as-is
-- (USING true) — it already covers everything including customer-scoped rows.
-- If we later want to tighten so coaches only see their team's rows, we'd
-- replace that policy. For v1 the read path filters in the query, not in RLS,
-- keeping things compatible with existing super-admin tooling.

COMMENT ON COLUMN public.player_predictions.customer_team_id IS
  'Customer team owning this projection row. NULL = global/universal (legacy returner rows). Set on pre-computed transfer projections via scripts/precompute-transfer-projections.ts.';

COMMENT ON TABLE public.customer_team_equation_overrides IS
  'Per-customer-team equation weight overrides. Layered on top of equation_weights / model_config at compute time. Eager pre-compute reads these to produce team-tuned projections.';
