-- Front Office (GM): let the "Other" budget bucket be broken into named funding
-- lines (camps, vendors, donor, etc.). Stored as a JSON array of {name, amount};
-- gm_budget.other_total remains the summed total those lines add up to.
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS other_breakdown jsonb;
