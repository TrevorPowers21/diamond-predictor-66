-- Make GM funding sources BUILD-scoped (was team-scoped). A funding category
-- (vendor) now belongs to a specific team_build, so each build carries its own
-- funding plan and cloning a build clones its funding. This powers scenario
-- planning: Build A pays a player's $20K from an NIL vendor, Build B pays the
-- same $20K from Rev Share, and the GM toggles between them.
--
-- "Unassigned" money is NOT a source row: it reuses the existing per-player
-- gm_player_finance.nil_amount / other_amount (per build) as the direct/flex
-- portion. A player's NIL = nil_amount (Unassigned) + SUM(NIL vendor allocations).
--
-- The gm_allocation row (source + player + amount) is a "deal" — a future
-- contract PDF + terms will attach to it.

-- Brand-new tables (only test data); clear before adding the NOT NULL build FK.
TRUNCATE public.gm_allocation, public.gm_allocation_source;

ALTER TABLE public.gm_allocation_source
  ADD COLUMN IF NOT EXISTS team_build_id uuid REFERENCES public.team_builds(id) ON DELETE CASCADE;
ALTER TABLE public.gm_allocation_source ALTER COLUMN team_build_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_allocation_source_build
  ON public.gm_allocation_source (team_build_id, bucket);

NOTIFY pgrst, 'reload schema';
