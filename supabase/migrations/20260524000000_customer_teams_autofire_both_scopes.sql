-- Eager pre-compute autofire — extend trigger to enqueue BOTH hitter + pitcher
-- jobs on customer_teams INSERT.
--
-- Replaces the original fn_customer_teams_autofire_precompute body (which only
-- enqueued hitters_d1). Same vault secret dependencies; same fire-and-forget
-- HTTP semantics; the Edge Function now dispatches to runHitterPrecompute or
-- runPitcherPrecompute based on job.scope.

CREATE OR REPLACE FUNCTION public.fn_customer_teams_autofire_precompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $body$
DECLARE
  v_hitter_job_id uuid;
  v_pitcher_job_id uuid;
  v_url text;
  v_service_key text;
  v_request_id bigint;
BEGIN
  -- Skip internal placeholder teams (no school_team_id)
  IF NEW.school_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Enqueue BOTH jobs so the queue reflects what the team needs.
  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'hitters_d1', 'customer_team_insert')
  RETURNING id INTO v_hitter_job_id;

  INSERT INTO public.precompute_jobs (customer_team_id, scope, trigger_source)
  VALUES (NEW.id, 'pitchers_d1', 'customer_team_insert')
  RETURNING id INTO v_pitcher_job_id;

  -- Vault secrets (set per environment). If missing, jobs stay pending and a
  -- manual run picks them up — safe failure mode.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'precompute_edge_function_url' LIMIT 1;

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets WHERE name = 'precompute_service_role_key' LIMIT 1;

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'autofire-precompute: vault secrets missing - jobs % (hitter) + % (pitcher) stay pending', v_hitter_job_id, v_pitcher_job_id;
    RETURN NEW;
  END IF;

  -- Fire both POSTs. Edge Function claims and processes each based on job.scope.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('jobId', v_hitter_job_id)
  ) INTO v_request_id;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('jobId', v_pitcher_job_id)
  ) INTO v_request_id;

  RETURN NEW;
END;
$body$;

COMMENT ON FUNCTION public.fn_customer_teams_autofire_precompute IS
  'Trigger fn: on customer_teams INSERT, enqueues hitter + pitcher precompute jobs and pings the process-precompute-jobs Edge Function for each. Vault secrets precompute_edge_function_url + precompute_service_role_key must be set per-environment.';
