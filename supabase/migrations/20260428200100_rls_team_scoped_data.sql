-- Step 4b — RLS for team-scoped data tables.
--
-- Pattern: superadmin OR member of the row's customer_team_id can read/write.
-- Policies replace the prior user-scoped (auth.uid() = user_id) and
-- role-scoped (has_role(..., 'admin'/'staff')) policies.
--
-- IMPORTANT — apply order:
--   1. Step 1 migrations (add customer_team_id columns)
--   2. Bootstrap SQL (backfill customer_team_id on existing rows to the demo team)
--   3. THIS migration (lock down access)
--
-- Applying this BEFORE the bootstrap will make existing rows invisible to
-- everyone except superadmins, because rows with customer_team_id = NULL
-- match neither branch of the policy.
--
-- nil_valuations and player_predictions are intentionally NOT scoped here.
-- Both stay globally readable by any authenticated user (per plan §3).
-- team_build_players is scoped via its parent (team_builds.customer_team_id)
-- since it doesn't carry its own customer_team_id column.

-- ─────────────────────────────────────────────────────────────────────
-- target_board
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own target board" ON public.target_board;
DROP POLICY IF EXISTS "Users can insert own target board" ON public.target_board;
DROP POLICY IF EXISTS "Users can update own target board" ON public.target_board;
DROP POLICY IF EXISTS "Users can delete own target board" ON public.target_board;

CREATE POLICY "target_board_select" ON public.target_board
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );

CREATE POLICY "target_board_modify" ON public.target_board
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );

-- ─────────────────────────────────────────────────────────────────────
-- team_builds
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can manage their own team_builds" ON public.team_builds;
DROP POLICY IF EXISTS "Staff can read all team_builds" ON public.team_builds;

CREATE POLICY "team_builds_select" ON public.team_builds
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );

CREATE POLICY "team_builds_modify" ON public.team_builds
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );

-- ─────────────────────────────────────────────────────────────────────
-- team_build_players (scoped via parent team_builds.customer_team_id)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can manage team_build_players via build ownership" ON public.team_build_players;
DROP POLICY IF EXISTS "Staff can read team_build_players" ON public.team_build_players;

CREATE POLICY "team_build_players_select" ON public.team_build_players
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
        AND public.is_team_member(tb.customer_team_id)
    )
  );

CREATE POLICY "team_build_players_modify" ON public.team_build_players
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
        AND public.is_team_member(tb.customer_team_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
        AND public.is_team_member(tb.customer_team_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- coach_notes (created out-of-band; ensure RLS enabled and policies clean)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.coach_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own coach_notes" ON public.coach_notes;
DROP POLICY IF EXISTS "Users can insert own coach_notes" ON public.coach_notes;
DROP POLICY IF EXISTS "Users can update own coach_notes" ON public.coach_notes;
DROP POLICY IF EXISTS "Users can delete own coach_notes" ON public.coach_notes;
DROP POLICY IF EXISTS "coach_notes_select" ON public.coach_notes;
DROP POLICY IF EXISTS "coach_notes_modify" ON public.coach_notes;

CREATE POLICY "coach_notes_select" ON public.coach_notes
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );

CREATE POLICY "coach_notes_modify" ON public.coach_notes
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR public.is_team_member(customer_team_id)
  );
