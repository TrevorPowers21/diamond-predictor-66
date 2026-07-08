-- Extra contact numbers for a recruit — a flexible list beyond the fixed
-- player / guardian / coach fields (additional family, second coach, agent,
-- etc.). Array of { label, value } objects.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS extra_contacts jsonb;
