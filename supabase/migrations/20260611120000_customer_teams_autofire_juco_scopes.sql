-- Extend the customer_teams autofire trigger to also enqueue JUCO precompute
-- jobs (both hitter + pitcher). The edge function supports scope = 'juco' for
-- hitters and scope = 'pitchers_juco' for pitchers as of this branch.
--
-- Supersedes 20260524000000_customer_teams_autofire_both_scopes.sql.

-- Widen the scope CHECK constraint to allow the new 'pitchers_juco' scope.
ALTER TABLE public.precompute_jobs
  DROP CONSTRAINT IF EXISTS precompute_jobs_scope_check;
ALTER TABLE public.precompute_jobs
  ADD CONSTRAINT precompute_jobs_scope_check
  CHECK (scope IN ('hitters_d1', 'pitchers_d1', 'juco', 'pitchers_juco', 'all'));

CREATE OR REPLACE FUNCTION public.fn_customer_teams_autofire_precompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
  v_hitter_d1_job_id    uuid;
  v_pitcher_d1_job_id   uuid;
  v_hitter_juco_job_id  uuid;
  v_pitcher_juco_job_id uuid;
  v_url                 text;
  v_service_key         text;
  v_request_id          bigint;
BEGIN
  IF NEW.school_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enqueue all four jobs so the queue reflects what the team needs.
  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'hitters_d1', 'customer_team_insert')
  RETURNING id INTO v_hitter_d1_job_id;

  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'pitchers_d1', 'customer_team_insert')
  RETURNING id INTO v_pitcher_d1_job_id;

  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'juco', 'customer_team_insert')
  RETURNING id INTO v_hitter_juco_job_id;

  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'pitchers_juco', 'customer_team_insert')
  RETURNING id INTO v_pitcher_juco_job_id;

  -- Vault secrets — if missing, jobs stay pending for manual processing.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'precompute_edge_function_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets WHERE name = 'precompute_service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'autofire-precompute: vault secrets missing - jobs % (hitter d1) + % (pitcher d1) + % (hitter juco) + % (pitcher juco) stay pending',
      v_hitter_d1_job_id, v_pitcher_d1_job_id, v_hitter_juco_job_id, v_pitcher_juco_job_id;
    RETURN NEW;
  END IF;

  -- Fire one POST per job. Edge Function claims + processes each by scope.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object('jobId', v_hitter_d1_job_id)
  ) INTO v_request_id;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object('jobId', v_pitcher_d1_job_id)
  ) INTO v_request_id;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object('jobId', v_hitter_juco_job_id)
  ) INTO v_request_id;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object('jobId', v_pitcher_juco_job_id)
  ) INTO v_request_id;

  RETURN NEW;
END;
$body$;

COMMENT ON FUNCTION public.fn_customer_teams_autofire_precompute IS
  'Trigger fn: on customer_teams INSERT, enqueues hitter_d1 + pitcher_d1 + juco + pitchers_juco precompute jobs and pings the process-precompute-jobs Edge Function for each.';
