-- 2026-06-23 — Expected stats (xBA / xSLG / xwOBA) lookup table
--
-- 2D bucket model matching MLB Statcast methodology:
--   * 1-mph EV bins
--   * 1-degree LA bins
--   * Train on every batted ball in pitch_log
--   * Probabilities derived from actual outcomes per bucket
--
-- Per-bucket fields:
--   p_1b, p_2b, p_3b, p_hr  → outcome probabilities
--   p_hit                    → p_1b + p_2b + p_3b + p_hr
--   expected_bases           → 1*p_1b + 2*p_2b + 3*p_3b + 4*p_hr  (drives xSLG)
--   expected_woba            → linear-weighted sum             (drives xwOBA)
--
-- Linear weights (MLB 2023 baseline; recompute for college later if drift):
--   1B = 0.882, 2B = 1.254, 3B = 1.586, HR = 2.041
--
-- Populated by scripts/build_xba_lookup.ts. Re-run whenever pitch_log
-- batted-ball data changes materially (new CSVs, new season, etc.).
--
-- Sparsity handling: buckets with sample_n < 5 will be smoothed via
-- neighbor averaging in the build script.

CREATE TABLE IF NOT EXISTS public.pitch_log_xba_lookup (
  ev_bin integer NOT NULL,           -- floor(exit_velocity)
  la_bin integer NOT NULL,           -- floor(launch_angle)
  sample_n integer NOT NULL,
  p_1b numeric NOT NULL,
  p_2b numeric NOT NULL,
  p_3b numeric NOT NULL,
  p_hr numeric NOT NULL,
  p_hit numeric NOT NULL,
  expected_bases numeric NOT NULL,
  expected_woba numeric NOT NULL,
  smoothed boolean NOT NULL DEFAULT FALSE,
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ev_bin, la_bin)
);

COMMENT ON TABLE public.pitch_log_xba_lookup IS
  '2D (EV, LA) expected-stats lookup. MLB-style methodology. Joins to per-pitch batted balls during aggregation to derive xBA, xSLG, xwOBA per player per dimension.';

CREATE INDEX IF NOT EXISTS idx_xba_lookup_ev_la
  ON public.pitch_log_xba_lookup(ev_bin, la_bin);

-- RLS — read-only for authenticated, matches other pitch_log tables
ALTER TABLE public.pitch_log_xba_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pitch_log_xba_lookup"
  ON public.pitch_log_xba_lookup
  FOR SELECT TO authenticated USING (true);
