-- Projection tier for a recruit (Draft Prospect / Immediate Impact / …),
-- editable over time, shown on the card + reports.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS projection_tier text;
