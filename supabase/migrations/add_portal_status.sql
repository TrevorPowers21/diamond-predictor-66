-- Add portal_status column to players (replaces boolean transfer_portal)
-- Values: 'NOT IN PORTAL', 'IN PORTAL', 'COMMITTED'
alter table public.players
  add column if not exists portal_status text not null default 'NOT IN PORTAL'
  check (portal_status in ('NOT IN PORTAL', 'IN PORTAL', 'COMMITTED'));

-- Migrate existing transfer_portal boolean data
update public.players
  set portal_status = 'IN PORTAL'
  where transfer_portal = true;

-- Drop the status column from target_board since portal status is now on players
alter table public.target_board
  drop column if exists status;
