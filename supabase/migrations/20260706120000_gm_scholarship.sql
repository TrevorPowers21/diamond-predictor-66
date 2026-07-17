-- Front Office (GM) v1: add a per-player, per-season scholarship figure to the
-- roster finance table. Sits alongside the funding buckets (rev_share / nil /
-- other) as an informational/compliance dollar amount; does NOT feed Actual Pay.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS scholarship_amount numeric;
