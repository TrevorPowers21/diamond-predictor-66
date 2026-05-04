-- Public Supabase Storage bucket for per-team school logos uploaded via
-- AdminTeams → Branding. Public read so the SchoolBanner can load logos
-- without needing signed URLs. Writes are gated to authenticated users
-- with the superadmin role (the same gate that already protects
-- AdminTeams).

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-logos', 'school-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for everyone — logos render in unauthenticated previews too.
DROP POLICY IF EXISTS "school_logos_public_read" ON storage.objects;
CREATE POLICY "school_logos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'school-logos');

-- Only superadmins can upload / replace / delete logos.
DROP POLICY IF EXISTS "school_logos_superadmin_write" ON storage.objects;
CREATE POLICY "school_logos_superadmin_write"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'school-logos'
    AND public.has_role(auth.uid(), 'superadmin')
  );

DROP POLICY IF EXISTS "school_logos_superadmin_update" ON storage.objects;
CREATE POLICY "school_logos_superadmin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND public.has_role(auth.uid(), 'superadmin')
  );

DROP POLICY IF EXISTS "school_logos_superadmin_delete" ON storage.objects;
CREATE POLICY "school_logos_superadmin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'school-logos'
    AND public.has_role(auth.uid(), 'superadmin')
  );
