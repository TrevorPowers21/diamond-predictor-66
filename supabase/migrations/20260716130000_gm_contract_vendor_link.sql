-- Slice 3a of the vendor unification: link contracts + funding sources to the
-- program vendor directory (gm_vendor), and backfill the directory from the
-- vendor names that already exist in both places.

ALTER TABLE public.gm_contract          ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.gm_vendor(id) ON DELETE SET NULL;
ALTER TABLE public.gm_allocation_source ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.gm_vendor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gm_contract_vendor          ON public.gm_contract (vendor_id);
CREATE INDEX IF NOT EXISTS idx_gm_allocation_source_vendor ON public.gm_allocation_source (vendor_id);

-- Backfill gm_vendor from existing funding-source names (case-insensitive, per
-- bucket, per team — matching the unique index). NIL/Other only (Rev = school).
INSERT INTO public.gm_vendor (customer_team_id, name, bucket)
SELECT DISTINCT ON (customer_team_id, lower(name), bucket) customer_team_id, name, bucket
FROM public.gm_allocation_source s
WHERE s.bucket IN ('nil','other') AND coalesce(btrim(s.name),'') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.gm_vendor v
                  WHERE v.customer_team_id = s.customer_team_id AND lower(v.name) = lower(s.name) AND v.bucket = s.bucket)
ORDER BY customer_team_id, lower(name), bucket;

-- ...and from existing contract vendor names.
INSERT INTO public.gm_vendor (customer_team_id, name, bucket)
SELECT DISTINCT ON (customer_team_id, lower(vendor_name), bucket) customer_team_id, vendor_name, bucket
FROM public.gm_contract c
WHERE c.bucket IN ('nil','other') AND coalesce(btrim(c.vendor_name),'') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.gm_vendor v
                  WHERE v.customer_team_id = c.customer_team_id AND lower(v.name) = lower(c.vendor_name) AND v.bucket = c.bucket)
ORDER BY customer_team_id, lower(vendor_name), bucket;

-- Link each source + contract to its vendor.
UPDATE public.gm_allocation_source s SET vendor_id = v.id
FROM public.gm_vendor v
WHERE v.customer_team_id = s.customer_team_id AND lower(v.name) = lower(s.name) AND v.bucket = s.bucket AND s.vendor_id IS NULL;

UPDATE public.gm_contract c SET vendor_id = v.id
FROM public.gm_vendor v
WHERE v.customer_team_id = c.customer_team_id AND lower(v.name) = lower(c.vendor_name) AND v.bucket = c.bucket AND c.vendor_id IS NULL;
