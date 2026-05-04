-- Step 1d — Add customer_team_id to team-scoped tables.
--
-- Each row in these tables now belongs to a specific customer team. The
-- column is initially nullable so existing rows continue to work; the
-- bootstrap SQL backfills them all to the seed "RSTR IQ All-Americans"
-- demo team. A future migration (Step 4) sets NOT NULL once backfill is
-- verified.
--
-- coach_notes already has a `team_id uuid` column (no FK). Rename it to
-- customer_team_id for consistency and attach the FK constraint.
--
-- nil_valuations is intentionally NOT scoped here. It is currently global
-- (all coaches see the same valuation). Plan §4 says to confirm before
-- per-team scoping; deferred to a later phase.

-- target_board
ALTER TABLE public.target_board
  ADD COLUMN customer_team_id uuid REFERENCES public.customer_teams(id);

CREATE INDEX idx_target_board_customer_team_id
  ON public.target_board(customer_team_id);

-- team_builds
ALTER TABLE public.team_builds
  ADD COLUMN customer_team_id uuid REFERENCES public.customer_teams(id);

CREATE INDEX idx_team_builds_customer_team_id
  ON public.team_builds(customer_team_id);

-- coach_notes — rename existing team_id and attach FK
ALTER TABLE public.coach_notes
  RENAME COLUMN team_id TO customer_team_id;

ALTER TABLE public.coach_notes
  ADD CONSTRAINT coach_notes_customer_team_id_fkey
  FOREIGN KEY (customer_team_id) REFERENCES public.customer_teams(id);

CREATE INDEX idx_coach_notes_customer_team_id
  ON public.coach_notes(customer_team_id);
