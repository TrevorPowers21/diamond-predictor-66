-- Recruiting-board money: what the recruit/his camp is asking, and the offer
-- we're targeting. Used for forward class budgeting and to inject a realistic
-- expected cost when a committed recruit is projected onto a future roster
-- (instead of $0).
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS asking_price numeric,
  ADD COLUMN IF NOT EXISTS target_offer numeric;
