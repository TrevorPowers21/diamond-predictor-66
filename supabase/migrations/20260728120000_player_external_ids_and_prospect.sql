-- Identity foundation, part 1 of 2 (part 2 = 20260728121000_resolve_or_create_prospect.sql).
--
-- player_external_ids: vendor-agnostic identity crosswalk. players.id is the canonical
-- identity; each external vendor key (trumedia | pbr | pg | rstr | ...) is one row here.
-- UNIQUE(source, external_id) blocks one vendor id from attaching to two people (the
-- de-dup guard). App-wide READ (identity is global, holds no program-private data);
-- writes go ONLY through resolve_or_create_prospect() (SECURITY DEFINER) — no client
-- write policy on purpose. Additive + idempotent.
create table if not exists public.player_external_ids (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  source      text not null,
  external_id text not null,
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists idx_player_external_ids_player on public.player_external_ids (player_id);

alter table public.player_external_ids enable row level security;

drop policy if exists player_external_ids_read on public.player_external_ids;
create policy player_external_ids_read on public.player_external_ids
  for select to authenticated using (true);
-- (no insert/update/delete policy: writes are service-role via the RPC)

-- Add 'prospect' to players.data_status so coach-added, not-yet-real players are
-- flagged and excluded from rankings/projections until real data links in.
alter table public.players drop constraint if exists players_data_status_check;
alter table public.players add constraint players_data_status_check
  check (data_status in ('complete','partial','no_data','outlier','prospect'));
