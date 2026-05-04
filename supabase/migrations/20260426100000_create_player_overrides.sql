-- Player overrides table for hitter-side coach adjustments.
-- Replaces the localStorage-only overrides at src/lib/playerOverrides.ts
-- (key: team_builder_player_overrides_v1).
--
-- Mirrors the pitcher_role_overrides pattern: one row per player, upsert on
-- write, delete-row to clear. Pitcher class_transition / dev_aggressiveness
-- continue to live on player_predictions (migrated 2026-04-23) — that
-- separation matches the broader hitter/pitcher split across the codebase.
--
-- Phase 5 will add team_id + RLS to scope per program.

CREATE TABLE IF NOT EXISTS public.player_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  position TEXT,
  class_transition TEXT,
  dev_aggressiveness NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One override row per player (upsert on conflict)
CREATE UNIQUE INDEX IF NOT EXISTS player_overrides_player_id_unique
  ON public.player_overrides(player_id);

-- Constrain class_transition to valid values
ALTER TABLE public.player_overrides
  DROP CONSTRAINT IF EXISTS player_overrides_class_transition_check;

ALTER TABLE public.player_overrides
  ADD CONSTRAINT player_overrides_class_transition_check
  CHECK (class_transition IS NULL OR class_transition IN ('FS', 'SJ', 'JS', 'GR'));

-- Constrain dev_aggressiveness to the three discrete buckets used in the UI
ALTER TABLE public.player_overrides
  DROP CONSTRAINT IF EXISTS player_overrides_dev_aggressiveness_check;

ALTER TABLE public.player_overrides
  ADD CONSTRAINT player_overrides_dev_aggressiveness_check
  CHECK (dev_aggressiveness IS NULL OR dev_aggressiveness IN (0, 0.5, 1));
