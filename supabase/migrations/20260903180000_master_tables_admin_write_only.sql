-- ============================================================================
-- Master tables — reads stay open, WRITES become admin/staff only
--
-- WHY
--   `Hitter Master`, `Pitching Master`, `Pitch Arsenal` and `Conference Stats` carry `ALL` policies
--   granted to `{public}`. `ALL` includes DELETE, so ANY authenticated user could run:
--
--       await supabase.from("Pitching Master").delete().eq("Season", season)
--
--   …which is a call the app already makes (importHistoricalPitchers.ts:206). Nothing in the
--   database refused it. Confirmed present on BOTH staging and prod.
--
--   And the UI does not stop it either — all three layers are open:
--     · the "Admin" sidebar item has no `requires`, so every logged-in user sees the link
--     · `/dashboard/admin` is wrapped in ProtectedRoute, which checks AUTH ONLY, no role
--     · these policies
--   RLS is the only one of the three that enforces rather than suggests, so it is fixed first.
--   The two UI gaps are logged separately; this migration does not depend on them.
--
-- WHAT CHANGES
--   SELECT stays open — the app reads these tables from many surfaces and none of that changes.
--   INSERT / UPDATE / DELETE require admin or staff, matching how `player_predictions` is already
--   governed ("Staff can manage player_predictions").
--
-- IMPACT ANALYSIS — every writer was traced before writing this
--   importHistoricalHitters · importHistoricalPitchers · importPitchArsenal · importPaAbData
--   · computeAndStoreScores · PitchingConferenceStatsTable — ALL invoked only from
--   AdminDashboard.tsx. The three coach-facing pages that appear to call computeAndStoreScores
--   (PlayerProfile, ReturningPlayers, PitcherProfile) only MENTION IT IN COMMENTS; there is no
--   call site. Verified with `grep -rn "computeAndStoreScores(" src/pages`.
--   ⇒ No coach-facing flow writes to these tables. Nothing a normal user does should break.
--
--   Scripts and precomputes are unaffected: they run under the service role, which bypasses RLS.
--
-- ROLLBACK
--   supabase/rollback/20260903180000_master_tables_admin_write_only_rollback.sql
-- ============================================================================

BEGIN;

-- ── Hitter Master ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public insert" ON public."Hitter Master";
DROP POLICY IF EXISTS "Allow public update" ON public."Hitter Master";
DROP POLICY IF EXISTS "Allow public write"  ON public."Hitter Master";

CREATE POLICY "Admin/staff can write Hitter Master"
  ON public."Hitter Master" FOR ALL TO authenticated
  USING      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- ── Pitching Master ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public write"  ON public."Pitching Master";
DROP POLICY IF EXISTS "Allow public insert" ON public."Pitching Master";
DROP POLICY IF EXISTS "Allow public update" ON public."Pitching Master";

CREATE POLICY "Admin/staff can write Pitching Master"
  ON public."Pitching Master" FOR ALL TO authenticated
  USING      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- ── Pitch Arsenal ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public write" ON public."Pitch Arsenal";

CREATE POLICY "Admin/staff can write Pitch Arsenal"
  ON public."Pitch Arsenal" FOR ALL TO authenticated
  USING      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- ── Conference Stats ─────────────────────────────────────────────────────────
-- Two overlapping ALL policies here rather than one; both go.
DROP POLICY IF EXISTS "conference_stats_allow_all"        ON public."Conference Stats";
DROP POLICY IF EXISTS "conference_stats_allow_all_writes" ON public."Conference Stats";

CREATE POLICY "Admin/staff can write Conference Stats"
  ON public."Conference Stats" FOR ALL TO authenticated
  USING      (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

-- Reads are deliberately NOT touched. All four tables already carry an "Allow public read" SELECT
-- policy on both databases (verified 2026-09-03), and adding a second would be redundant noise —
-- permissive policies are OR'd, so one is enough and two just make the next audit harder to read.

COMMIT;
