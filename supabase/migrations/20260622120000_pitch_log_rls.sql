-- 2026-06-22 — RLS on pitch_log + aggregation tables
--
-- Discovered mid-spot-check 2026-06-22: the four pitch_log tables had
-- no explicit RLS or read policies, so PostgREST returned empty result
-- sets for client (authenticated) queries even though data existed.
-- Service role keys were unaffected — that's how the aggregation
-- scripts could write but the Stats page couldn't read.
--
-- Matches the existing project pattern (pitching_power_ratings_storage,
-- pitch_arsenal, pitching_stats_storage, etc.): enable RLS + grant
-- authenticated SELECT. Writes stay restricted to service_role.

ALTER TABLE public.pitch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_log_pitcher_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_log_pitcher_by_pitch_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_log_hitter_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitch_log"
  ON public.pitch_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pitch_log_pitcher_totals"
  ON public.pitch_log_pitcher_totals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pitch_log_pitcher_by_pitch_type"
  ON public.pitch_log_pitcher_by_pitch_type
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pitch_log_hitter_totals"
  ON public.pitch_log_hitter_totals
  FOR SELECT TO authenticated USING (true);
