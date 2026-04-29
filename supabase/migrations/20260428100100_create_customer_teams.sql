-- Step 1b — Create customer_teams table.
--
-- Each row is one school that pays for RSTR IQ. This is the unit of tenancy
-- for multi-tenant access control. Distinct from the existing
-- public."Teams Table" (note the space + capitals — that's the D1 program
-- lookup, used by players.team_id and other roster code).
--
-- school_team_id is a FK back to that D1 program lookup, so a customer team
-- can be linked to "their" D1 program for branding (logo, colors, etc).

CREATE TABLE public.customer_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  school_team_id uuid REFERENCES public."Teams Table"(id),
  savant_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_customer_teams_school_team_id
  ON public.customer_teams(school_team_id);

CREATE INDEX idx_customer_teams_active
  ON public.customer_teams(active) WHERE active = true;

-- Enable RLS now so writes are blocked by default. Real policies (superadmin
-- bypass + team membership read) land in Step 4.
ALTER TABLE public.customer_teams ENABLE ROW LEVEL SECURITY;
