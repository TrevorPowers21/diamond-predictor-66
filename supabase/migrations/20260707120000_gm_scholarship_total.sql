-- Front Office (GM): scholarship gets a program allotment like the other funding
-- buckets (rev_share / nil / other), so the Scholarship box shows used / cap and
-- feeds the Total allotment. Pairs with gm_player_finance.scholarship_amount.
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS scholarship_total numeric;
