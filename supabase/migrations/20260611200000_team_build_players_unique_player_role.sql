-- Enforce one (build_id, player_id, position_slot) row in team_build_players.
--
-- Why: the TB target search add path went through a brief race where the
-- supabase-target-board sync effect could fire with stale closure-captured
-- rosterPlayers and insert a duplicate of a saved-build player. Client-side
-- dedup now exists (upfront alreadyOnRoster guard + setRosterPlayers updater-
-- pattern dedup at apply time), but a DB constraint is the durable
-- guarantee. Any path — present or future — that tries to insert a duplicate
-- gets rejected.
--
-- Why position_slot is in the key: TWPs (two-way players) legitimately have
-- TWO rows per build with the same (build_id, player_id): one with a hitter
-- position_slot and one with a pitcher slot (SP/RP). A constraint on just
-- (build_id, player_id) would block them. Including position_slot allows
-- the TWP duo through while still rejecting same-side dupes.
--
-- NULLS NOT DISTINCT (Postgres 15+): treat NULL position_slot rows as
-- conflicting with other NULL rows. Default Postgres unique behavior would
-- let unlimited NULL position_slot duplicates through, which defeats the
-- guarantee for any hitter row that lands with position_slot=null.
--
-- Pre-check confirmed no existing in-build duplicates on prod or staging
-- (audit query: GROUP BY (build_id, player_id, position_slot) HAVING > 1
-- returned zero rows), so this can apply without a cleanup step.

ALTER TABLE team_build_players
  ADD CONSTRAINT team_build_players_unique_player_role
  UNIQUE NULLS NOT DISTINCT (build_id, player_id, position_slot);
