-- Add age, bats_hand, and throws_hand columns to players table
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS age integer;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS bats_hand text;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS throws_hand text;