-- Backfill: mint / attach a canonical RSTR IQ identity for every recruit already
-- on the board that has a full name and no player_id yet. Idempotent — only touches
-- rows where player_id IS NULL. Auto-links to an existing identity when a shared
-- PBR/PG key is already in the crosswalk; otherwise mints a fresh prospect.
-- STAGING FIRST, then prod (Trevor drives).
DO $$
declare
  r   record;
  v_id uuid;
  v_src text;
  v_ext text;
begin
  for r in
    select * from public.gm_recruits
    where player_id is null
      and coalesce(btrim(first_name), '') <> ''
      and coalesce(btrim(last_name), '') <> ''
  loop
    v_ext := nullif(btrim(coalesce(r.link, '')), '');
    v_src := case
               when v_ext is null then null
               when r.link ~* 'prepbaseballreport|pbr' then 'pbr'
               when r.link ~* 'perfectgame' then 'pg'
               else 'profile'
             end;
    v_id := public.resolve_or_create_prospect(
      r.first_name, r.last_name, r.position, r.high_school, null,
      r.class_year::text, 'D1', v_src, v_ext
    );
    update public.gm_recruits set player_id = v_id where id = r.id;
  end loop;
end $$;

-- Verify: how many recruits still lack an identity (expected: only no-name rows).
select
  count(*)                                   as total_recruits,
  count(player_id)                           as with_identity,
  count(*) filter (where player_id is null)  as without_identity
from public.gm_recruits;
