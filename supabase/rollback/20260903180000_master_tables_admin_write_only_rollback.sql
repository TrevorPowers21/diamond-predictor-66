-- Rollback for 20260903180000_master_tables_admin_write_only.sql
--
-- ⚠ Restores PUBLIC WRITE on all four master tables. After this, any authenticated user can again
--   DELETE a season of Pitching Master. Only run it if the admin import flows are actually broken —
--   and if they are, the fix is to give that account the admin/staff role, not to reopen the table.

BEGIN;

DROP POLICY IF EXISTS "Admin/staff can write Hitter Master"    ON public."Hitter Master";
DROP POLICY IF EXISTS "Admin/staff can write Pitching Master"  ON public."Pitching Master";
DROP POLICY IF EXISTS "Admin/staff can write Pitch Arsenal"    ON public."Pitch Arsenal";
DROP POLICY IF EXISTS "Admin/staff can write Conference Stats" ON public."Conference Stats";

CREATE POLICY "Allow public insert" ON public."Hitter Master"    FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON public."Hitter Master"    FOR UPDATE USING (true);
CREATE POLICY "Allow public write"  ON public."Pitching Master"  FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "Allow public write"  ON public."Pitch Arsenal"    FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "conference_stats_allow_all" ON public."Conference Stats" FOR ALL USING (true) WITH CHECK (true);

COMMIT;
