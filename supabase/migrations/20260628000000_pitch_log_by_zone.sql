-- Pitch Log: per-pitch zone label + per-zone aggregation tables.
--
-- Goal (Trevor): a configurable zone/field display where the user picks
-- ANY metric to color the 13-zone heatmap and toggles panels. We store the
-- full count-component set per zone (mirroring the by_pitch_type tables), so
-- every metric derives from one (player, dimension) read of 13 rows.
--
-- 13-zone definition matches src/savant/components/PitchZone*.tsx
-- `zoneForPitch` EXACTLY (so stored == displayed):
--   in-zone 3x3 grid (PXNorm/PZNorm unit square) -> '1'..'9' row-major,
--   row0=top (pz>1/3), col0=left (px<-1/3);
--   outside the unit square -> quadrant 'UL'/'UR'/'LL'/'LR' by sign;
--   |px|>4 or |pz|>4 -> NULL (tracking noise).
-- Absolute (catcher's view) — NOT batter-relative inside/outside.

-- ── Per-row label on the raw log ─────────────────────────────────────────
ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS pitch_zone text;

CREATE INDEX IF NOT EXISTS idx_pitch_log_pitch_zone ON public.pitch_log (pitch_zone) WHERE pitch_zone IS NOT NULL;

COMMENT ON COLUMN public.pitch_log.pitch_zone IS
  '13-zone strike-zone location from px_norm/pz_norm: ''1''..''9'' in-zone 3x3 (row-major, row0=top/col0=left), ''UL''/''UR''/''LL''/''LR'' outside quadrants. NULL if no location or |px|>4/|pz|>4. Matches zoneForPitch in PitchZone*.tsx.';

-- ── Pitcher per-zone aggregation (mirror pitcher_by_pitch_type) ──────────
CREATE TABLE IF NOT EXISTS public.pitch_log_pitcher_by_zone (
  pitcher_id   text    NOT NULL,
  season       integer NOT NULL,
  pitch_zone   text    NOT NULL,
  dimension_key text   NOT NULL,
  pitches               integer NOT NULL DEFAULT 0,
  swings                integer NOT NULL DEFAULT 0,
  whiffs                integer NOT NULL DEFAULT 0,
  in_zone               integer NOT NULL DEFAULT 0,
  in_zone_swings        integer NOT NULL DEFAULT 0,
  in_zone_whiffs        integer NOT NULL DEFAULT 0,
  chases                integer NOT NULL DEFAULT 0,
  called_strikes        integer NOT NULL DEFAULT 0,
  data_pitches          integer NOT NULL DEFAULT 0,
  velo_pitches          integer NOT NULL DEFAULT 0,
  stuff_plus_sum        numeric,
  velo_sum              numeric,
  ivb_sum               numeric,
  hb_sum                numeric,
  extension_sum         numeric,
  spin_sum              numeric,
  rel_height_sum        numeric,
  rel_side_sum          numeric,
  batted_balls_allowed_in_play integer NOT NULL DEFAULT 0,
  batted_barrels_allowed       integer NOT NULL DEFAULT 0,
  batted_hard_hit_allowed      integer NOT NULL DEFAULT 0,
  ev_sum_allowed               numeric,
  batted_balls_allowed_with_ev integer NOT NULL DEFAULT 0,
  batted_ground_balls_allowed  integer NOT NULL DEFAULT 0,
  batted_line_drives_allowed   integer NOT NULL DEFAULT 0,
  batted_fly_balls_allowed     integer NOT NULL DEFAULT 0,
  batted_pop_ups_allowed       integer NOT NULL DEFAULT 0,
  hits_single_allowed   integer NOT NULL DEFAULT 0,
  hits_double_allowed   integer NOT NULL DEFAULT 0,
  hits_triple_allowed   integer NOT NULL DEFAULT 0,
  hits_hr_allowed       integer NOT NULL DEFAULT 0,
  ab                    integer NOT NULL DEFAULT 0,
  x_hits_sum_allowed    numeric,
  x_bases_sum_allowed   numeric,
  x_woba_sum_allowed    numeric,
  out_of_zone           integer NOT NULL DEFAULT 0,
  balls                 integer NOT NULL DEFAULT 0,
  fouls                 integer NOT NULL DEFAULT 0,
  hbps_caused           integer NOT NULL DEFAULT 0,
  walks_caused          integer NOT NULL DEFAULT 0,
  strikeouts_caused     integer NOT NULL DEFAULT 0,
  looking_strikeouts    integer NOT NULL DEFAULT 0,
  swinging_strikeouts   integer NOT NULL DEFAULT 0,
  ev_90                 numeric,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pitcher_id, season, pitch_zone, dimension_key)
);

-- ── Hitter per-zone aggregation (mirror hitter_by_pitch_type) ───────────
CREATE TABLE IF NOT EXISTS public.pitch_log_hitter_by_zone (
  batter_id    text    NOT NULL,
  season       integer NOT NULL,
  pitch_zone   text    NOT NULL,
  dimension_key text   NOT NULL,
  pa            integer NOT NULL DEFAULT 0,
  ab            integer NOT NULL DEFAULT 0,
  hits_single   integer NOT NULL DEFAULT 0,
  hits_double   integer NOT NULL DEFAULT 0,
  hits_triple   integer NOT NULL DEFAULT 0,
  hits_hr       integer NOT NULL DEFAULT 0,
  k             integer NOT NULL DEFAULT 0,
  bb            integer NOT NULL DEFAULT 0,
  hbp           integer NOT NULL DEFAULT 0,
  pitches       integer NOT NULL DEFAULT 0,
  swings        integer NOT NULL DEFAULT 0,
  whiffs        integer NOT NULL DEFAULT 0,
  chases        integer NOT NULL DEFAULT 0,
  in_zone       integer NOT NULL DEFAULT 0,
  in_zone_swings integer NOT NULL DEFAULT 0,
  in_zone_whiffs integer NOT NULL DEFAULT 0,
  fouls         integer NOT NULL DEFAULT 0,
  batted_balls_in_play integer NOT NULL DEFAULT 0,
  batted_barrels       integer NOT NULL DEFAULT 0,
  batted_hard_hit      integer NOT NULL DEFAULT 0,
  ev_sum               numeric,
  batted_balls_with_ev integer NOT NULL DEFAULT 0,
  max_ev               numeric,
  x_hits_sum           numeric,
  x_bases_sum          numeric,
  x_woba_sum           numeric,
  out_of_zone          integer NOT NULL DEFAULT 0,
  ev_90                numeric,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batter_id, season, pitch_zone, dimension_key)
);

-- ── RLS: authenticated SELECT (matches other pitch_log agg tables) ──────
ALTER TABLE public.pitch_log_pitcher_by_zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_log_hitter_by_zone  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read pitch_log_pitcher_by_zone" ON public.pitch_log_pitcher_by_zone;
CREATE POLICY "Authenticated users can read pitch_log_pitcher_by_zone"
  ON public.pitch_log_pitcher_by_zone FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated users can read pitch_log_hitter_by_zone" ON public.pitch_log_hitter_by_zone;
CREATE POLICY "Authenticated users can read pitch_log_hitter_by_zone"
  ON public.pitch_log_hitter_by_zone FOR SELECT TO authenticated USING (true);
