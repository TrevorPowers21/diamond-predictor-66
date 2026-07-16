-- Slice 4a of the vendor unification: persist how each funding source's pool was
-- funded, so delete can subtract from the cap (new money) or optionally return
-- the carved amount to the general base (from_base).
--   funding_mode = 'new_money' → added on top of the bucket (cap grew by total)
--   funding_mode = 'from_base' → carved from the general base (cap unchanged);
--   base_offset = the exact dollars pulled from the base at creation (0 for new money).
-- Existing rows default to new_money / 0 (their original mode is unknown — the
-- safe assumption is that deleting them subtracts from the cap, no return prompt).
ALTER TABLE public.gm_allocation_source
  ADD COLUMN IF NOT EXISTS funding_mode text NOT NULL DEFAULT 'new_money' CHECK (funding_mode IN ('new_money','from_base'));
ALTER TABLE public.gm_allocation_source
  ADD COLUMN IF NOT EXISTS base_offset numeric NOT NULL DEFAULT 0;
