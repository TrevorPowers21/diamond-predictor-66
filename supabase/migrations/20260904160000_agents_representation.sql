-- Agent representation: agencies → agents → players, plus program-private notes/contacts.
--
-- Scoping doctrine (mirrors player_external_ids, 20260728120000):
--   Identity is GLOBAL and holds no program-private data, so it is read-to-all. Writes go
--   through SECURITY DEFINER RPCs that dedupe case-insensitively, so no client policy can
--   let one program's typo create a second "Boras Corp".
--
-- Why provenance is a SEPARATE table and not a created_by column on player_agents:
--   Trevor's requirement is that a link "appear no different than if I added it" — Arkansas
--   must not see that Georgia's coach made it. RLS is ROW-level, not column-level: if the
--   link row is readable by everyone, so is every column on it. Hiding it in the UI would
--   not hide it from the API. Provenance therefore lives in its own superadmin-only table.
--
-- Why agent_contacts is rows, not columns:
--   The public/private line is expected to move — an agency may later authorize us to share
--   cell numbers through the app. Typing contacts by (visibility, source) makes that a data
--   change rather than a migration.
--
-- Additive + idempotent. No backfill. No existing table is modified.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. agencies — optional parent. College baseball has plenty of solo operators,
--    so an agent is NOT required to have one.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  website    text,
  city       text,
  state      text,
  created_at timestamptz not null default now()
);

-- "Recognize an existing agency": case- and whitespace-insensitive.
create unique index if not exists idx_agencies_lower_name
  on public.agencies (lower(btrim(name)));

alter table public.agencies enable row level security;

drop policy if exists agencies_read on public.agencies;
create policy agencies_read on public.agencies
  for select to authenticated using (true);

-- Corrections to shared identity are superadmin-only: anyone may CREATE an agency
-- (via the RPC), but a coach must not be able to rename or delete one every other
-- program can see.
drop policy if exists agencies_admin_write on public.agencies;
create policy agencies_admin_write on public.agencies
  for update to authenticated
  using      (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role));

drop policy if exists agencies_admin_delete on public.agencies;
create policy agencies_admin_delete on public.agencies
  for delete to authenticated
  using (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. agents
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agents (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid references public.agencies(id) on delete set null,
  first_name text not null,
  last_name  text not null,
  title      text,
  created_at timestamptz not null default now()
);

-- Two different "John Smith" at two different agencies are two different people, so the
-- dedupe key includes the agency. Unaffiliated agents share a sentinel so that NULL
-- agency_id still collides on name (NULL would otherwise never equal NULL in an index).
create unique index if not exists idx_agents_identity
  on public.agents (
    lower(btrim(first_name)),
    lower(btrim(last_name)),
    coalesce(agency_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_agents_agency on public.agents (agency_id);

alter table public.agents enable row level security;

drop policy if exists agents_read on public.agents;
create policy agents_read on public.agents
  for select to authenticated using (true);

drop policy if exists agents_admin_write on public.agents;
create policy agents_admin_write on public.agents
  for update to authenticated
  using      (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role));

drop policy if exists agents_admin_delete on public.agents;
create policy agents_admin_delete on public.agents
  for delete to authenticated
  using (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. player_agents — global, dated. Representation is fact, not opinion, so every
--    program sees the same answer. NOTE: deliberately carries NO created_by column.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.player_agents (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players(id) on delete cascade,
  agent_id   uuid not null references public.agents(id)  on delete cascade,
  started_at date,
  ended_at   date,
  created_at timestamptz not null default now()
);

-- One ACTIVE agent per player. A second coach linking a different agent collides here and
-- the app offers "currently linked to X — replace?" instead of writing a competing row.
-- Ended links stay, so switching agencies is history rather than an overwrite.
-- ⚠ A partial unique INDEX, not ADD CONSTRAINT — a constraint cannot carry a WHERE clause,
-- and that exact kind-mismatch is the one live migration drift in this repo.
create unique index if not exists idx_player_agents_one_active
  on public.player_agents (player_id)
  where ended_at is null;

create index if not exists idx_player_agents_agent on public.player_agents (agent_id);

alter table public.player_agents enable row level security;

drop policy if exists player_agents_read on public.player_agents;
create policy player_agents_read on public.player_agents
  for select to authenticated using (true);

-- No client write policy: links are created and ended by link_player_agent() /
-- unlink_player_agent() below, which also record provenance. Superadmin may correct
-- directly when fixing a conflict.
drop policy if exists player_agents_admin_write on public.player_agents;
create policy player_agents_admin_write on public.player_agents
  for all to authenticated
  using      (public.has_role(auth.uid(), 'superadmin'::public.app_role))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. player_agents_provenance — superadmin only. This is the table that makes
--    "no credit on the row" true at the database level rather than in the UI.
--    Deliberately NOT cascade-deleted with the link: the record of who asserted
--    what must survive the link being replaced.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.player_agents_provenance (
  id                 uuid primary key default gen_random_uuid(),
  player_id          uuid not null,
  agent_id           uuid not null,
  action             text not null check (action in ('link','replace','unlink')),
  created_by_user_id uuid,
  created_at         timestamptz not null default now()
);

create index if not exists idx_player_agents_prov_player
  on public.player_agents_provenance (player_id, created_at desc);

alter table public.player_agents_provenance enable row level security;

-- Read: superadmin only. Write: none — the RPCs are SECURITY DEFINER and bypass RLS.
drop policy if exists player_agents_prov_admin on public.player_agents_provenance;
create policy player_agents_prov_admin on public.player_agents_provenance
  for select to authenticated
  using (public.has_role(auth.uid(), 'superadmin'::public.app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. agent_contacts — the public/private split, expressed as data.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agent_contacts (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents(id) on delete cascade,
  kind             text not null check (kind in
                     ('email','phone','cell','x','instagram','linkedin','website','other')),
  value            text not null,
  label            text,
  visibility       text not null check (visibility in ('global','program')),
  source           text not null default 'coach_entered'
                     check (source in ('agency_provided','coach_entered','rstr')),
  customer_team_id uuid references public.customer_teams(id) on delete cascade,
  created_at       timestamptz not null default now(),

  -- A program row must name its program; a global row must not carry one. Without this,
  -- a mislabelled row leaks a private cell number to every program.
  constraint agent_contacts_scope_ck check (
    (visibility = 'program' and customer_team_id is not null) or
    (visibility = 'global'  and customer_team_id is null)
  )
);

create index if not exists idx_agent_contacts_agent on public.agent_contacts (agent_id);
create index if not exists idx_agent_contacts_team
  on public.agent_contacts (customer_team_id) where customer_team_id is not null;

alter table public.agent_contacts enable row level security;

drop policy if exists agent_contacts_read on public.agent_contacts;
create policy agent_contacts_read on public.agent_contacts
  for select to authenticated
  using (
    visibility = 'global'
    or public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or public.is_team_member(customer_team_id)
  );

-- Asymmetric on purpose: adding is open (a coach who has the agency's office email should
-- be able to put it in), but EDITING or DELETING shared data is superadmin-only.
drop policy if exists agent_contacts_insert on public.agent_contacts;
create policy agent_contacts_insert on public.agent_contacts
  for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or visibility = 'global'
    or public.is_team_member(customer_team_id)
  );

drop policy if exists agent_contacts_update on public.agent_contacts;
create policy agent_contacts_update on public.agent_contacts
  for update to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or (visibility = 'program' and public.is_team_member(customer_team_id))
  )
  with check (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or (visibility = 'program' and public.is_team_member(customer_team_id))
  );

drop policy if exists agent_contacts_delete on public.agent_contacts;
create policy agent_contacts_delete on public.agent_contacts
  for delete to authenticated
  using (
    public.has_role(auth.uid(), 'superadmin'::public.app_role)
    or (visibility = 'program' and public.is_team_member(customer_team_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. gm_agent_notes — notes AND the contact timeline, one table typed by kind.
--    Same protection class as player evaluation notes. RLS mirrors gm_vendor.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.gm_agent_notes (
  id                 uuid primary key default gen_random_uuid(),
  customer_team_id   uuid not null references public.customer_teams(id) on delete cascade,
  agent_id           uuid not null references public.agents(id) on delete cascade,
  -- Optional: a note about this agent regarding one specific client.
  player_id          uuid references public.players(id) on delete set null,
  kind               text not null default 'note'
                       check (kind in ('note','call','email','text','meeting','other')),
  body               text,
  occurred_at        timestamptz not null default now(),
  created_by_user_id uuid,
  created_at         timestamptz not null default now()
);

create index if not exists idx_gm_agent_notes_team_agent
  on public.gm_agent_notes (customer_team_id, agent_id, occurred_at desc);

alter table public.gm_agent_notes enable row level security;

drop policy if exists gm_agent_notes_all on public.gm_agent_notes;
create policy gm_agent_notes_all on public.gm_agent_notes
  for all to authenticated
  using      (public.has_role(auth.uid(), 'superadmin'::public.app_role) or public.is_team_member(customer_team_id))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role) or public.is_team_member(customer_team_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPCs. All SECURITY DEFINER: they are the only write path into shared identity,
--    which is what keeps dedupe non-optional.
-- ─────────────────────────────────────────────────────────────────────────────

-- resolve_or_create_agency: returns the existing agency for a name, else creates it.
create or replace function public.resolve_or_create_agency(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'resolve_or_create_agency: name is required';
  end if;

  select id into v_id from public.agencies
    where lower(btrim(name)) = lower(btrim(p_name)) limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.agencies (name) values (btrim(p_name)) returning id into v_id;
  return v_id;
end;
$$;

-- resolve_or_create_agent: agency is optional. Pass p_agency_name to resolve-or-create the
-- agency in the same call, or p_agency_id when it is already known.
create or replace function public.resolve_or_create_agent(
  p_first       text,
  p_last        text,
  p_agency_id   uuid default null,
  p_agency_name text default null,
  p_title       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_agency uuid := p_agency_id;
begin
  if coalesce(btrim(p_first), '') = '' or coalesce(btrim(p_last), '') = '' then
    raise exception 'resolve_or_create_agent: first and last name are required';
  end if;

  if v_agency is null and coalesce(btrim(p_agency_name), '') <> '' then
    v_agency := public.resolve_or_create_agency(p_agency_name);
  end if;

  select id into v_id from public.agents
    where lower(btrim(first_name)) = lower(btrim(p_first))
      and lower(btrim(last_name))  = lower(btrim(p_last))
      and coalesce(agency_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(v_agency,  '00000000-0000-0000-0000-000000000000'::uuid)
    limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.agents (first_name, last_name, agency_id, title)
  values (btrim(p_first), btrim(p_last), v_agency, p_title)
  returning id into v_id;

  return v_id;
end;
$$;

-- link_player_agent: the single write path for representation.
--   p_replace = false → raises if the player already has a different active agent, so the
--                       app can prompt rather than silently overwrite someone's entry.
--   p_replace = true  → ends the current link (ended_at = today) and opens the new one.
-- Re-linking the SAME agent is a no-op that returns the existing row: idempotent, and it
-- does not reset started_at.
create or replace function public.link_player_agent(
  p_player_id  uuid,
  p_agent_id   uuid,
  p_replace    boolean default false,
  p_started_at date    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id    uuid;
  v_existing_agent uuid;
  v_id             uuid;
begin
  if p_player_id is null or p_agent_id is null then
    raise exception 'link_player_agent: player_id and agent_id are required';
  end if;

  select id, agent_id into v_existing_id, v_existing_agent
    from public.player_agents
    where player_id = p_player_id and ended_at is null
    limit 1;

  if v_existing_agent = p_agent_id then
    return v_existing_id;                      -- already linked; nothing to do
  end if;

  if v_existing_id is not null then
    if not p_replace then
      raise exception 'player is already represented by agent %', v_existing_agent
        using errcode = 'unique_violation';
    end if;
    update public.player_agents
      set ended_at = current_date
      where id = v_existing_id;
  end if;

  insert into public.player_agents (player_id, agent_id, started_at)
  values (p_player_id, p_agent_id, coalesce(p_started_at, current_date))
  returning id into v_id;

  insert into public.player_agents_provenance (player_id, agent_id, action, created_by_user_id)
  values (p_player_id, p_agent_id,
          case when v_existing_id is null then 'link' else 'replace' end,
          auth.uid());

  return v_id;
end;
$$;

-- unlink_player_agent: ends the active link. Keeps the row, so history survives.
create or replace function public.unlink_player_agent(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
begin
  select agent_id into v_agent
    from public.player_agents
    where player_id = p_player_id and ended_at is null
    limit 1;

  if v_agent is null then
    return;
  end if;

  update public.player_agents
    set ended_at = current_date
    where player_id = p_player_id and ended_at is null;

  insert into public.player_agents_provenance (player_id, agent_id, action, created_by_user_id)
  values (p_player_id, v_agent, 'unlink', auth.uid());
end;
$$;

grant execute on function public.resolve_or_create_agency(text)                       to authenticated;
grant execute on function public.resolve_or_create_agent(text, text, uuid, text, text) to authenticated;
grant execute on function public.link_player_agent(uuid, uuid, boolean, date)          to authenticated;
grant execute on function public.unlink_player_agent(uuid)                             to authenticated;
