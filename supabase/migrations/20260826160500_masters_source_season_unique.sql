-- A11: UNIQUE (source_player_id, "Season") on Hitter Master + Pitching Master.
-- Needed as the ON CONFLICT target for derive_masters_from_pitchlog upserts (Phase C).
-- Verified 0 true duplicate keys on prod (30,025 / 29,238 distinct, stable id-ordered scan).
-- Had no committed migration (ad-hoc on staging) — added here. Idempotent via pg_constraint guard.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hitter_master_source_player_season_uniq') then
    alter table "Hitter Master" add constraint hitter_master_source_player_season_uniq unique (source_player_id, "Season");
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pitching_master_source_player_season_uniq') then
    alter table "Pitching Master" add constraint pitching_master_source_player_season_uniq unique (source_player_id, "Season");
  end if;
end $$;
