-- ============================================================================
-- Tighten player_predictions READ RLS (2026-08-23).
--
-- WAS: `"Authenticated users can read player_predictions" FOR SELECT USING (true)`
-- (20260211192838…:81-82) — ANY authenticated user could read EVERY row, including other
-- programs' per-team precomputed projections. Team-scoping was app-code only
-- (src/lib/teamScopedPredictions.ts applyTeamScopeFilter). Raw API calls / forgotten
-- filters leaked cross-team.
--
-- NOW: DB-enforced team scope, matching the target_board / team_builds pattern:
--   - shared GLOBAL rows (customer_team_id IS NULL — the returner/regular predictions that
--     ALL programs share) stay readable by everyone (mirrors the app filter
--     `or(customer_team_id.is.null, customer_team_id.eq.<team>)`),
--   - a program's own per-team precomputed rows readable only by its members,
--   - superadmin reads all.
-- Writes are unchanged (still admin/staff-gated via "Staff can manage player_predictions").
-- No app change needed — the read path already filters to null-or-own-team.
-- ============================================================================

drop policy if exists "Authenticated users can read player_predictions" on public.player_predictions;

create policy "player_predictions_select_team_scoped" on public.player_predictions
  for select
  to authenticated
  using (
    customer_team_id is null
    or public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or public.is_team_member(customer_team_id)
  );
