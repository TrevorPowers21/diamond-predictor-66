-- Per-team scoping for the High Follow list. Mirrors the pattern from
-- 20260428100300_add_customer_team_id_to_scoped_tables.sql for target_board
-- and team_builds: nullable customer_team_id with FK to customer_teams plus
-- a covering index. Existing rows stay nullable; the useHighFollow hook
-- treats null-scoped rows as legacy / invisible to team-scoped views.

ALTER TABLE public.high_follow
  ADD COLUMN IF NOT EXISTS customer_team_id uuid REFERENCES public.customer_teams(id);

CREATE INDEX IF NOT EXISTS idx_high_follow_customer_team_id
  ON public.high_follow(customer_team_id);

-- The original (user_id, player_id) uniqueness blocks tracking the same
-- player on multiple teams' high-follow lists for one user. Replace with
-- a composite unique on (user_id, customer_team_id, player_id) so each
-- team's list is independent. Defensive DROP IF EXISTS — the original
-- constraint name is unknown, so we drop by walking pg_constraint.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.high_follow'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.high_follow DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

-- Treat NULL customer_team_id as legacy / orphaned: the index uses NULLS
-- NOT DISTINCT so legacy null-scoped rows still can't dupe each other,
-- and team-scoped rows are unique within their team.
ALTER TABLE public.high_follow
  ADD CONSTRAINT high_follow_user_team_player_unique
  UNIQUE (user_id, customer_team_id, player_id);

-- Same fix for target_board: yesterday's change scoped reads/writes to
-- customer_team_id but didn't touch the original (user_id, player_id)
-- uniqueness, which would now block adding the same player to multiple
-- teams' boards under one superadmin user.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.target_board'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.target_board DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

ALTER TABLE public.target_board
  ADD CONSTRAINT target_board_user_team_player_unique
  UNIQUE (user_id, customer_team_id, player_id);
