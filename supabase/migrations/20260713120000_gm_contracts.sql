-- GM Contracts: signed-contract storage for the front office. Each contract is a
-- real signed document (team-level, NOT per-build) attached to a player, tagged
-- with the money bucket it falls under (Rev Share / NIL / Other) and, for
-- NIL/Other, the vendor it backs. The PDF lives in the private `gm-contracts`
-- storage bucket; the extracted terms + AI parse live here. Obligations built
-- into the contract are tracked as child rows so they can be checked off.

CREATE TABLE IF NOT EXISTS public.gm_contract (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id          uuid NOT NULL,
  title              text,
  bucket             text NOT NULL CHECK (bucket IN ('rev', 'nil', 'other')),
  vendor_name        text,                       -- the NIL vendor / Other source (free text; build-agnostic)
  total_value        numeric,
  start_date         date,
  end_date           date,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'expired', 'terminated')),
  pdf_path           text,                       -- storage key in the gm-contracts bucket: <customer_team_id>/<uuid>.pdf
  pdf_name           text,                       -- original filename for display
  summary            text,                       -- AI one-line summary
  parsed             jsonb,                      -- raw AI extraction, kept for audit
  notes              text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_contract_team_player ON public.gm_contract (customer_team_id, player_id);

ALTER TABLE public.gm_contract ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_contract_all ON public.gm_contract;
CREATE POLICY gm_contract_all ON public.gm_contract
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

CREATE TABLE IF NOT EXISTS public.gm_contract_obligation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  contract_id        uuid NOT NULL REFERENCES public.gm_contract(id) ON DELETE CASCADE,
  description        text NOT NULL,
  due_date           date,
  fulfilled          boolean NOT NULL DEFAULT false,
  fulfilled_at       timestamptz,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_contract_obligation_contract ON public.gm_contract_obligation (contract_id);

ALTER TABLE public.gm_contract_obligation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_contract_obligation_all ON public.gm_contract_obligation;
CREATE POLICY gm_contract_obligation_all ON public.gm_contract_obligation
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

-- Private storage bucket for the contract PDFs. Path convention encodes the
-- owning team as the first folder so RLS can gate access by team membership:
--   <customer_team_id>/<uuid>.pdf
INSERT INTO storage.buckets (id, name, public)
VALUES ('gm-contracts', 'gm-contracts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gm_contracts_team_read" ON storage.objects;
CREATE POLICY "gm_contracts_team_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'gm-contracts'
    AND (public.has_role(auth.uid(), 'superadmin'::public.app_role)
         OR public.is_team_member(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "gm_contracts_team_insert" ON storage.objects;
CREATE POLICY "gm_contracts_team_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gm-contracts'
    AND (public.has_role(auth.uid(), 'superadmin'::public.app_role)
         OR public.is_team_member(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "gm_contracts_team_update" ON storage.objects;
CREATE POLICY "gm_contracts_team_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gm-contracts'
    AND (public.has_role(auth.uid(), 'superadmin'::public.app_role)
         OR public.is_team_member(((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "gm_contracts_team_delete" ON storage.objects;
CREATE POLICY "gm_contracts_team_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gm-contracts'
    AND (public.has_role(auth.uid(), 'superadmin'::public.app_role)
         OR public.is_team_member(((storage.foldername(name))[1])::uuid))
  );

NOTIFY pgrst, 'reload schema';
