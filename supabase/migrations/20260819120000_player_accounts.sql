-- Player app: player_accounts.
--
-- A player is an invite-only account, distinct from the coach/scout/admin
-- hierarchy (user_roles / user_team_access). Staff sends the invite via
-- `npm run invite-player` (scripts/invite-player.ts), mirroring the coach
-- app's invite-user-to-team flow. 1:1 with auth.users, keyed on user_id
-- (not a surrogate id) — same shape as the existing profiles table.
--
-- roster_player_id is a nullable future link to public.players (scouting
-- data) — not set anywhere yet, and not client-editable (see the
-- roster-link guard migration): a player must not be able to self-claim to
-- be a specific roster player.

CREATE TABLE public.player_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  date_of_birth date,
  graduation_year integer,
  roster_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.player_accounts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_player_accounts_updated_at
  BEFORE UPDATE ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create the player_accounts row when the invite is sent. Deliberately
-- a SEPARATE trigger from the existing handle_new_user()/on_auth_user_created
-- (which also fires for coach invites) — a bug here must never be able to
-- break the coach invite flow. Discriminated by raw_user_meta_data->>'app',
-- set via the `data` option on the admin.inviteUserByEmail() call in
-- scripts/invite-player.ts.
--
-- This runs server-side on auth.users insert rather than a client-side
-- insert, since the player has no session at all until they click the
-- invite link and set a password — a client insert before that point would
-- have no auth.uid() and fail RLS.
CREATE OR REPLACE FUNCTION public.handle_new_player_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'app' = 'player' THEN
    INSERT INTO public.player_accounts (user_id, email, first_name, last_name)
    VALUES (
      NEW.id,
      NEW.email,
      NEW.raw_user_meta_data->>'first_name',
      NEW.raw_user_meta_data->>'last_name'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_player
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_player_account();
