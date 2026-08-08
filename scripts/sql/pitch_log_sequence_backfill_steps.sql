-- ============================================================================
-- pitch_log SEQUENCE backfill — runbook (staging first, then prod on "prod, now?")
-- Adds pitch_num_in_game / ab_num_in_game / pitch_num_in_ab from the DRS Pitch Log CSVs.
-- Batched server-side (a monolithic 2.5M-row editor UPDATE dies on gateway disconnect).
-- ============================================================================

-- STEP 1 — add the columns (also in supabase/migrations/20260808_pitch_log_add_sequence.sql)
alter table pitch_log
  add column if not exists pitch_num_in_game int,
  add column if not exists ab_num_in_game    int,
  add column if not exists pitch_num_in_ab   int;

-- STEP 2 — temp landing table the loader fills
drop table if exists pitch_log_seq;
create table pitch_log_seq (
  uniq_pitch_id     text primary key,
  pitch_num_in_game int,
  ab_num_in_game    int,
  pitch_num_in_ab   int
);

-- >>> now run:  node scripts/backfill_pitch_log_sequence.mjs --apply   (loads pitch_log_seq, ~2.5M rows)

-- STEP 3 — batched UPDATE function (each call commits < gateway timeout)
create or replace function backfill_pitch_log_seq_batch(_after text, _lim int)
returns table(processed int, last_id text)
language plpgsql as $$
declare v_ids text[];
begin
  select array_agg(uniq_pitch_id order by uniq_pitch_id) into v_ids
  from (select uniq_pitch_id from pitch_log_seq where uniq_pitch_id > _after
        order by uniq_pitch_id limit _lim) s;
  if v_ids is null then processed := 0; last_id := _after; return next; return; end if;
  update pitch_log p set
    pitch_num_in_game = s.pitch_num_in_game,
    ab_num_in_game    = s.ab_num_in_game,
    pitch_num_in_ab   = s.pitch_num_in_ab
  from pitch_log_seq s
  where p.uniq_pitch_id = s.uniq_pitch_id and s.uniq_pitch_id = any(v_ids);
  processed := array_length(v_ids, 1);
  last_id   := v_ids[array_length(v_ids, 1)];
  return next;
end $$;

-- >>> now run:  node scripts/drive_pitch_log_sequence.mjs   (~105 calls × 25k, ~a few min)

-- STEP 4 — verify (expect with_seq ≈ pitch_log_rows ≈ 2,576,230)
select count(*) as pitch_log_rows,
       count(*) filter (where pitch_num_in_game is not null) as with_pitch_num,
       count(*) filter (where ab_num_in_game    is not null) as with_ab_num
from pitch_log;

-- STEP 5 — cleanup
drop function if exists backfill_pitch_log_seq_batch(text, int);
drop table if exists pitch_log_seq;
