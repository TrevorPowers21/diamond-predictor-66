-- Step 1c — Create user_team_access table.
--
-- Maps auth users to customer_teams with their role on that team. One user
-- can only belong to one customer team in v1 (enforced at app level — the
-- table technically allows more rows per user, but invite flow won't create
-- them).
--
-- Superadmins do NOT need rows here. Their cross-team access comes from
-- public.user_roles (role = 'superadmin').

CREATE TABLE public.user_team_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_team_id uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('team_admin', 'general_user')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  PRIMARY KEY (user_id, customer_team_id)
);

CREATE INDEX idx_user_team_access_user_id
  ON public.user_team_access(user_id);

CREATE INDEX idx_user_team_access_customer_team_id
  ON public.user_team_access(customer_team_id);

-- Enable RLS now so writes are blocked by default. Real policies land in
-- Step 4 — read your own row + superadmin sees all.
ALTER TABLE public.user_team_access ENABLE ROW LEVEL SECURITY;
