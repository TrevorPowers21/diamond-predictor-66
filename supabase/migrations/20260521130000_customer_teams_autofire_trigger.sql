-- Eager pre-compute — auto-fire trigger on customer_teams INSERT
--
-- When a new customer_team row is inserted (provisioning a new customer),
-- this trigger:
--   1. Inserts a 'pending' row into precompute_jobs
--   2. Fires an HTTP POST to the process-precompute-jobs Edge Function with
--      the new job_id in the body, which claims the job and runs precompute.
--
-- Result: new customer team → coach can log in within ~1 minute → projections
-- are populated. No manual CLI step.
--
-- DEPENDS ON:
--   * pg_net extension (HTTP from Postgres)
--   * supabase_vault extension (secrets store)
--   * vault secret named 'edge_function_url' containing the function URL
--   * vault secret named 'edge_function_service_role_key' containing the JWT
--
-- The two vault secrets are environment-specific (staging vs prod URLs +
-- keys). They are NOT created in this migration — operator must paste a
-- small SQL block after applying this migration (see comment block at the
-- bottom for the exact statements).

-- ============================================================================
-- 1. Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ============================================================================
-- 2. Trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_customer_teams_autofire_precompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_job_id uuid;
  v_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  -- Skip auto-fire when school_team_id is null (internal/placeholder customer
  -- teams like "RSTR IQ All-Americans" — precompute needs a real destination).
  IF NEW.school_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enqueue the job
  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'hitters_d1', 'customer_team_insert')
  RETURNING id INTO v_job_id;

  -- Look up edge function URL + service-role key from vault. If either is
  -- missing, the job sits in 'pending' forever until something processes
  -- it — that's the safe failure mode (manual run can still pick it up).
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'precompute_edge_function_url' LIMIT 1;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets WHERE name = 'precompute_service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'autofire-precompute: vault secrets missing — job % stays pending', v_job_id;
    RETURN NEW;
  END IF;

  -- Fire-and-forget HTTP POST to the Edge Function. pg_net returns a
  -- request id; the Edge Function claims the job, runs precompute, and
  -- updates the precompute_jobs row when done.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('jobId', v_job_id)
  ) INTO v_request_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_customer_teams_autofire_precompute IS
  'Trigger fn: on customer_teams INSERT, enqueues a precompute job and pings the process-precompute-jobs Edge Function. Vault secrets precompute_edge_function_url + precompute_service_role_key must be set per-environment.';

-- ============================================================================
-- 3. Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_customer_teams_autofire_precompute ON public.customer_teams;

CREATE TRIGGER trg_customer_teams_autofire_precompute
  AFTER INSERT ON public.customer_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_customer_teams_autofire_precompute();

-- ============================================================================
-- 4. OPERATOR: paste these AFTER applying this migration (replace values)
-- ============================================================================
-- STAGING (function URL + staging service role key):
--   SELECT vault.create_secret(
--     'https://slrxowawbijbjrkozqlj.supabase.co/functions/v1/process-precompute-jobs',
--     'precompute_edge_function_url',
--     'Edge Function URL for the eager precompute worker'
--   );
--   SELECT vault.create_secret(
--     '<STAGING SERVICE ROLE JWT>',
--     'precompute_service_role_key',
--     'Service role key the trigger uses to invoke process-precompute-jobs'
--   );
--
-- PROD (apply when promoting):
--   SELECT vault.create_secret(
--     'https://trbvxuoliwrfowibatkm.supabase.co/functions/v1/process-precompute-jobs',
--     'precompute_edge_function_url',
--     'Edge Function URL for the eager precompute worker'
--   );
--   SELECT vault.create_secret(
--     '<PROD SERVICE ROLE JWT>',
--     'precompute_service_role_key',
--     'Service role key the trigger uses to invoke process-precompute-jobs'
--   );
