-- Add an "asking price" alongside "willing to pay" on the GM target overlay.
-- Same (customer_team_id, player_id) row as gm_target_offer.offer_amount.
ALTER TABLE public.gm_target_offer ADD COLUMN IF NOT EXISTS asking_price numeric;

NOTIFY pgrst, 'reload schema';
