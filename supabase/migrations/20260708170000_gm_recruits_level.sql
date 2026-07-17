-- Recruit level (HS vs JUCO) and, for JUCO, how many years of eligibility they
-- arrive with. A HS commit is a true freshman (full clock); a JUCO commit has
-- burned time and enters with fewer years — this drives how long they show up
-- on future-season roster projections.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS level           text NOT NULL DEFAULT 'hs',  -- 'hs' | 'juco'
  ADD COLUMN IF NOT EXISTS years_remaining numeric;                     -- eligibility years on arrival (JUCO)
