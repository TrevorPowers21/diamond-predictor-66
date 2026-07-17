-- Slice 4b (sub-step 1) of the vendor unification: give contracts the same
-- funding accounting as funding sources, plus a link to the allocation they drive.
--   funding_mode = 'new_money' → the deal adds to the NIL/Other cap
--   funding_mode = 'from_base' → carved from the player's existing budget (cap unchanged);
--   base_offset  = dollars carved at save (0 for new money)
--   allocation_id → the gm_allocation this contract created/updated (the money line)
-- All default to new_money / 0 / null; the sync (sub-step 2) sets them.
ALTER TABLE public.gm_contract
  ADD COLUMN IF NOT EXISTS funding_mode text NOT NULL DEFAULT 'new_money' CHECK (funding_mode IN ('new_money','from_base'));
ALTER TABLE public.gm_contract
  ADD COLUMN IF NOT EXISTS base_offset numeric NOT NULL DEFAULT 0;
ALTER TABLE public.gm_contract
  ADD COLUMN IF NOT EXISTS allocation_id uuid REFERENCES public.gm_allocation(id) ON DELETE SET NULL;
