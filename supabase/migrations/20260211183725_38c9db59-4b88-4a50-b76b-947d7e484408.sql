
-- Players table
CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  position text,
  team text,
  conference text,
  class_year text,
  height_inches integer,
  weight integer,
  handedness text,
  home_state text,
  high_school text,
  transfer_portal boolean NOT NULL DEFAULT false,
  portal_entry_date date,
  headshot_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Season stats table
CREATE TABLE public.season_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
  season integer NOT NULL,
  games integer DEFAULT 0,
  at_bats integer DEFAULT 0,
  hits integer DEFAULT 0,
  doubles integer DEFAULT 0,
  triples integer DEFAULT 0,
  home_runs integer DEFAULT 0,
  rbi integer DEFAULT 0,
  runs integer DEFAULT 0,
  walks integer DEFAULT 0,
  strikeouts integer DEFAULT 0,
  stolen_bases integer DEFAULT 0,
  caught_stealing integer DEFAULT 0,
  hit_by_pitch integer DEFAULT 0,
  sac_flies integer DEFAULT 0,
  batting_avg numeric(4,3),
  on_base_pct numeric(4,3),
  slugging_pct numeric(4,3),
  ops numeric(5,3),
  -- Pitching stats
  innings_pitched numeric(5,1),
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  saves integer DEFAULT 0,
  earned_runs integer DEFAULT 0,
  era numeric(5,2),
  whip numeric(5,2),
  pitch_strikeouts integer DEFAULT 0,
  pitch_walks integer DEFAULT 0,
  hits_allowed integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, season)
);

-- Park factors table
CREATE TABLE public.park_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team text NOT NULL,
  venue_name text,
  season integer NOT NULL,
  overall_factor numeric(5,3) NOT NULL DEFAULT 1.000,
  hr_factor numeric(5,3) DEFAULT 1.000,
  hits_factor numeric(5,3) DEFAULT 1.000,
  runs_factor numeric(5,3) DEFAULT 1.000,
  doubles_factor numeric(5,3) DEFAULT 1.000,
  bb_factor numeric(5,3) DEFAULT 1.000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team, season)
);

-- Conference power ratings
CREATE TABLE public.power_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conference text NOT NULL,
  season integer NOT NULL,
  rating numeric(6,3) NOT NULL DEFAULT 1.000,
  rank integer,
  strength_of_schedule numeric(6,3),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conference, season)
);

-- Developmental weights for returning player model
CREATE TABLE public.developmental_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position text NOT NULL,
  from_class text NOT NULL,
  to_class text NOT NULL,
  weight numeric(5,3) NOT NULL DEFAULT 1.000,
  stat_category text NOT NULL DEFAULT 'overall',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(position, from_class, to_class, stat_category)
);

-- Conference-adjusted stats (computed/cached)
CREATE TABLE public.conference_adjusted_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
  season integer NOT NULL,
  adj_batting_avg numeric(4,3),
  adj_on_base_pct numeric(4,3),
  adj_slugging_pct numeric(4,3),
  adj_ops numeric(5,3),
  adj_era numeric(5,2),
  adj_whip numeric(5,2),
  park_factor_applied numeric(5,3),
  power_rating_applied numeric(6,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, season)
);

-- NIL valuations
CREATE TABLE public.nil_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
  season integer NOT NULL,
  estimated_value numeric(12,2),
  offensive_effectiveness numeric(6,3),
  component_breakdown jsonb DEFAULT '{}'::jsonb,
  model_version text DEFAULT '1.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, season)
);

-- Enable RLS on all tables
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.park_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.power_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.developmental_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conference_adjusted_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nil_valuations ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users can read all player data
CREATE POLICY "Authenticated users can read players" ON public.players FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read season_stats" ON public.season_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read park_factors" ON public.park_factors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read power_ratings" ON public.power_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read developmental_weights" ON public.developmental_weights FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read conference_adjusted_stats" ON public.conference_adjusted_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read nil_valuations" ON public.nil_valuations FOR SELECT TO authenticated USING (true);

-- RLS: Only admin/staff can write data
CREATE POLICY "Staff can manage players" ON public.players FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage season_stats" ON public.season_stats FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage park_factors" ON public.park_factors FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage power_ratings" ON public.power_ratings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage developmental_weights" ON public.developmental_weights FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage conference_adjusted_stats" ON public.conference_adjusted_stats FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));
CREATE POLICY "Staff can manage nil_valuations" ON public.nil_valuations FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')) WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Triggers for updated_at
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_season_stats_updated_at BEFORE UPDATE ON public.season_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_park_factors_updated_at BEFORE UPDATE ON public.park_factors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_power_ratings_updated_at BEFORE UPDATE ON public.power_ratings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_developmental_weights_updated_at BEFORE UPDATE ON public.developmental_weights FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conference_adjusted_stats_updated_at BEFORE UPDATE ON public.conference_adjusted_stats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_nil_valuations_updated_at BEFORE UPDATE ON public.nil_valuations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for common queries
CREATE INDEX idx_players_team ON public.players(team);
CREATE INDEX idx_players_conference ON public.players(conference);
CREATE INDEX idx_players_portal ON public.players(transfer_portal) WHERE transfer_portal = true;
CREATE INDEX idx_season_stats_player_season ON public.season_stats(player_id, season);
CREATE INDEX idx_nil_valuations_player ON public.nil_valuations(player_id);
