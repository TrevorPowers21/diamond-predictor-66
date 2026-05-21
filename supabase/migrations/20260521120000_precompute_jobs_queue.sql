-- Eager pre-compute — auto-fire queue
--
-- Queue table tracking precompute jobs (per-customer-team). Rows are
-- enqueued by:
--   * AFTER INSERT trigger on customer_teams (new team provisioned)
--   * Admin "Re-run precompute" button (debug / one-off)
--   * Future: stats ingest finalize, equation override change
--
-- A Supabase Edge Function polls this table, claims pending rows
-- (status='running'), runs the precompute logic, marks status='completed'
-- or 'failed'.

CREATE TABLE IF NOT EXISTS public.precompute_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'hitters_d1',
  -- pending | running | completed | failed
  status text NOT NULL DEFAULT 'pending',
  -- customer_team_insert | manual | stats_ingest | equation_change | override_change
  trigger_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  rows_written integer,
  CONSTRAINT precompute_jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  CONSTRAINT precompute_jobs_scope_check
    CHECK (scope IN ('hitters_d1', 'pitchers_d1', 'juco', 'all'))
);

-- Worker uses this index to pick up the oldest pending job
CREATE INDEX IF NOT EXISTS idx_precompute_jobs_pending
  ON public.precompute_jobs(created_at)
  WHERE status = 'pending';

-- Admin views of "what fired for this team"
CREATE INDEX IF NOT EXISTS idx_precompute_jobs_team
  ON public.precompute_jobs(customer_team_id, created_at DESC);

-- RLS: superadmin r/w. Service role (used by Edge Function) bypasses RLS.
ALTER TABLE public.precompute_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmin manages precompute jobs"
  ON public.precompute_jobs FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'staff'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'staff'::app_role)
  );

COMMENT ON TABLE public.precompute_jobs IS
  'Queue of pre-compute jobs (per-customer-team). Enqueued by triggers + admin actions, processed by the process-precompute-jobs Edge Function.';

COMMENT ON COLUMN public.precompute_jobs.scope IS
  'Which player population to precompute. hitters_d1 = the only one wired today. pitchers_d1 + juco arrive in future iterations.';

COMMENT ON COLUMN public.precompute_jobs.trigger_source IS
  'Why this job was created. customer_team_insert = auto-fire on new customer team. manual = admin button. The rest are future triggers.';
