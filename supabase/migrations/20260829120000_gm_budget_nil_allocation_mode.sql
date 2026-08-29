-- STAGE-0 / BRANCHWIDE BLOCKER B1 (audit 2026-08-29).
-- gm_budget.nil_allocation_mode is READ by the app (useNilAllocationMode.ts:24, RosterBudgetSettings.tsx:54,
-- useGmRoster.ts:193) but NO migration ever created it, so the column is MISSING on PROD: the Balanced/Top-Heavy
-- NIL toggle errors and allocateNil() silently falls back to 'balanced'.
-- Mirrors the shape of 20260710130000_gm_scholarship_mode.sql. Idempotent.
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS nil_allocation_mode text NOT NULL DEFAULT 'balanced'
  CHECK (nil_allocation_mode IN ('balanced', 'top_heavy'));

NOTIFY pgrst, 'reload schema';
