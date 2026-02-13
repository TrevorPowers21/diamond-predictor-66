
-- Create teams lookup table
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  conference text,
  division text DEFAULT 'D1',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read
CREATE POLICY "Authenticated users can read teams"
ON public.teams
FOR SELECT
TO authenticated
USING (true);

-- Staff/admin can manage
CREATE POLICY "Staff can manage teams"
ON public.teams
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'))
WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'staff'));

-- Auto-update timestamp
CREATE TRIGGER update_teams_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast conference lookups
CREATE INDEX idx_teams_conference ON public.teams (conference);
CREATE INDEX idx_teams_name ON public.teams (name);
