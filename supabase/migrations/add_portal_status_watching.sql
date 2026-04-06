-- Add WATCHING to portal_status check constraint
-- First drop the existing constraint, then re-add with WATCHING included
alter table public.players drop constraint if exists players_portal_status_check;
alter table public.players add constraint players_portal_status_check
  check (portal_status in ('NOT IN PORTAL', 'WATCHING', 'IN PORTAL', 'COMMITTED'));
