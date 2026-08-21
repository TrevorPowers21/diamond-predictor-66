-- Player app: prevent a player from self-claiming a roster identity.
--
-- The player_accounts_update policy allows a player to update their own row
-- (name, phone, etc.), which technically includes roster_player_id. Roster
-- linking is a future admin-only flow, not exposed in the player-app UI —
-- this trigger rejects any client-side change to that column outright,
-- regardless of what the (currently nonexistent) UI ever sends.
CREATE OR REPLACE FUNCTION public.prevent_roster_link_self_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.roster_player_id IS DISTINCT FROM OLD.roster_player_id
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'roster_player_id can only be changed by an administrative process';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER player_accounts_roster_link_guard
  BEFORE UPDATE ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_roster_link_self_edit();
