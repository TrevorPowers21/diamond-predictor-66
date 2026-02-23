
-- Team Builds table: stores saved roster builds per user
CREATE TABLE public.team_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'My Team Build',
  team text NOT NULL,
  season integer NOT NULL DEFAULT 2025,
  total_budget numeric DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage their own team_builds"
  ON public.team_builds FOR ALL
  USING (auth.uid() = user_id AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')))
  WITH CHECK (auth.uid() = user_id AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff')));

CREATE POLICY "Staff can read all team_builds"
  ON public.team_builds FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Team Build Players: individual roster slots
CREATE TABLE public.team_build_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL REFERENCES public.team_builds(id) ON DELETE CASCADE,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'returner', -- 'returner' or 'portal'
  custom_name text, -- for manually typed portal targets
  position_slot text, -- depth chart slot e.g. 'C', '1B', 'SP1'
  depth_order integer DEFAULT 1, -- 1=starter, 2=backup, etc.
  nil_value numeric DEFAULT 0,
  production_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_build_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage team_build_players via build ownership"
  ON public.team_build_players FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
    )
  );

CREATE POLICY "Staff can read team_build_players"
  ON public.team_build_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_builds tb
      WHERE tb.id = build_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
    )
  );

-- Timestamp triggers
CREATE TRIGGER update_team_builds_updated_at
  BEFORE UPDATE ON public.team_builds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_team_build_players_updated_at
  BEFORE UPDATE ON public.team_build_players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
