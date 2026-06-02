-- Allow authenticated users (admin clients) to read + manage the
-- portal_entries_unmatched review queue. Without these policies the
-- Portal Review tab silently rendered 0 rows even though the table had
-- data, because RLS was enabled but no policies existed.

ALTER TABLE public.portal_entries_unmatched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_unmatched"   ON public.portal_entries_unmatched;
DROP POLICY IF EXISTS "authenticated_update_unmatched" ON public.portal_entries_unmatched;
DROP POLICY IF EXISTS "authenticated_delete_unmatched" ON public.portal_entries_unmatched;
DROP POLICY IF EXISTS "authenticated_insert_unmatched" ON public.portal_entries_unmatched;

CREATE POLICY "authenticated_read_unmatched"
  ON public.portal_entries_unmatched
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_update_unmatched"
  ON public.portal_entries_unmatched
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_delete_unmatched"
  ON public.portal_entries_unmatched
  FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_insert_unmatched"
  ON public.portal_entries_unmatched
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
