-- resolve_or_create_prospect(): the SINGLE authoritative writer for coach-added
-- player identities. Used by the "add a new player" flow (mobile + target board).
--
-- Confirm-don't-guess (memory: identity-and-recruits `linking-is-confirm-not-guess`):
-- this function auto-resolves ONLY on an exact external key (e.g. a shared PBR/PG
-- profile URL already in the crosswalk). It NEVER fuzzy-matches by name — picking an
-- existing player from a name search is the UI's job (coach-confirmed). Otherwise it
-- mints a fresh prospect identity: a real players row (data_status='prospect') + a
-- stable rstr crosswalk id in the same key space as source_player_id.
--
-- SECURITY DEFINER so identity creation is centralized (not open players/crosswalk
-- writes to every authenticated user). Additive; safe to re-run (CREATE OR REPLACE).
create or replace function public.resolve_or_create_prospect(
  p_first      text,
  p_last       text,
  p_position   text default null,
  p_team       text default null,
  p_team_id    uuid default null,
  p_class_year text default null,
  p_division   text default 'D1',
  p_ext_source text default null,   -- e.g. 'pbr' — an exact external key for safe auto-link
  p_ext_id     text default null    -- e.g. the profile URL / id
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_src text;
begin
  if coalesce(btrim(p_first),'') = '' or coalesce(btrim(p_last),'') = '' then
    raise exception 'resolve_or_create_prospect: first and last name are required';
  end if;

  -- Certain auto-link ONLY: exact external key already mapped → reuse that identity.
  if p_ext_source is not null and p_ext_id is not null then
    select player_id into v_id
      from public.player_external_ids
      where source = p_ext_source and external_id = p_ext_id
      limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Otherwise mint a fresh prospect identity.
  v_id  := gen_random_uuid();
  v_src := 'rstr-' || replace(v_id::text, '-', '');   -- stable, stored once (not name-derived)

  insert into public.players
    (id, first_name, last_name, "position", team, team_id, class_year, division, data_status, source_player_id)
  values
    (v_id, btrim(p_first), btrim(p_last), p_position, p_team, p_team_id, p_class_year,
     coalesce(p_division, 'D1'), 'prospect', v_src);

  insert into public.player_external_ids (player_id, source, external_id)
  values (v_id, 'rstr', v_src);

  -- Record the external profile key too (so the next program that pastes the same
  -- profile resolves to THIS identity — cross-program de-dup without a fuzzy match).
  if p_ext_source is not null and p_ext_id is not null then
    insert into public.player_external_ids (player_id, source, external_id)
    values (v_id, p_ext_source, p_ext_id)
    on conflict (source, external_id) do nothing;
  end if;

  return v_id;
end;
$$;

grant execute on function public.resolve_or_create_prospect(text,text,text,text,uuid,text,text,text,text) to authenticated;
