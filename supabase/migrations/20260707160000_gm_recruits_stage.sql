-- Recruiting funnel stage per recruit: evaluating → contacted → offered →
-- unofficial → official → committed → signed (+ passed). Coaches advance it
-- along the recruiting journey.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'evaluating';
