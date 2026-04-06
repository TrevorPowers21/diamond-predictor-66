-- Target Board table: coach-curated watchlist of players
create table if not exists public.target_board (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'WATCHING' check (status in ('WATCHING', 'IN PORTAL', 'COMMITTED')),
  notes text,
  added_at timestamptz default now(),
  unique (user_id, player_id)
);

-- RLS
alter table public.target_board enable row level security;

create policy "Users can read own target board"
  on public.target_board for select
  using (auth.uid() = user_id);

create policy "Users can insert own target board"
  on public.target_board for insert
  with check (auth.uid() = user_id);

create policy "Users can update own target board"
  on public.target_board for update
  using (auth.uid() = user_id);

create policy "Users can delete own target board"
  on public.target_board for delete
  using (auth.uid() = user_id);

-- Index for fast lookups
create index if not exists idx_target_board_user on public.target_board(user_id);
