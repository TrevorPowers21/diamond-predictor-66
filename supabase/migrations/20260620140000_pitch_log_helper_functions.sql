-- 2026-06-20 — Pitch Log build helper Postgres functions
--
-- Two SECURITY DEFINER functions used by the pitch log scripts:
--
-- 1. exec_sql(sql text) — generic SQL executor with extended statement
--    timeout (15 min). Used by scripts/aggregate_pitch_log_dimensions.ts
--    to run filter-dimension INSERT...SELECT aggregations without
--    hitting Supabase's default 8s timeout for the authenticated role.
--
-- 2. bulk_update_pitch_log_stuff_plus(updates jsonb) — bulk UPDATE for
--    Stuff+ values via a JSON payload. Used by
--    scripts/compute_pitch_log_stuff_plus.ts. Avoids the per-row UPDATE
--    fanout that would take 3+ hours via PostgREST.
--
-- Both SECURITY DEFINER so they execute with the function owner's
-- privileges (matching the bulk_update + RLS-helper pattern used
-- elsewhere in this repo — see 20260428200000_rls_helper_functions.sql).
--
-- ⚠ exec_sql accepts arbitrary SQL — strictly an admin/script-only tool.
-- It runs as the function owner (typically postgres), bypassing RLS.
-- DO NOT expose to anon/authenticated clients via PostgREST without
-- removing the role's EXECUTE permission. The service_role key (used
-- by our backend scripts) is the only intended caller.

-- ── 1. exec_sql ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '900s'
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

COMMENT ON FUNCTION public.exec_sql(text) IS
  'Generic SQL executor with 15-min statement timeout. Used by pitch log aggregation scripts to run INSERT...SELECTs that exceed the default 8s timeout. SECURITY DEFINER — admin/script use only.';

-- Revoke from public + anon + authenticated so it's only callable by
-- service_role (which bypasses these grants automatically).
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM authenticated;

-- ── 2. bulk_update_pitch_log_stuff_plus ──────────────────────────────
CREATE OR REPLACE FUNCTION public.bulk_update_pitch_log_stuff_plus(updates jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected int;
BEGIN
  WITH u AS (
    SELECT (elem->>'uniq_pitch_id')::text AS uniq_pitch_id,
           (elem->>'stuff_plus')::numeric AS stuff_plus
    FROM jsonb_array_elements(updates) AS elem
  )
  UPDATE public.pitch_log p
  SET stuff_plus = u.stuff_plus
  FROM u
  WHERE p.uniq_pitch_id = u.uniq_pitch_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON FUNCTION public.bulk_update_pitch_log_stuff_plus(jsonb) IS
  'Bulk update Stuff+ scores via JSONB payload. Each call updates ~1000 rows in a single SQL UPDATE. Used by scripts/compute_pitch_log_stuff_plus.ts after per-pitch scoring + recenter. Idempotent (no inserts).';

REVOKE EXECUTE ON FUNCTION public.bulk_update_pitch_log_stuff_plus(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_update_pitch_log_stuff_plus(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_update_pitch_log_stuff_plus(jsonb) FROM authenticated;
