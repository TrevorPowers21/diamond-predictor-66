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

-- STEP 3 — batched UPDATE function. MUST override statement_timeout (else 25k-row batches trip the 8s
-- default) and use a RANGE join (not a 25k-element = any(array), which scans). Idempotent per cursor.
create or replace function backfill_pitch_log_seq_batch(_after text, _lim int)
returns table(processed int, last_id text)
language plpgsql
set statement_timeout = '0'
as $$
declare v_last text; v_cnt int;
begin
  select max(uniq_pitch_id), count(*) into v_last, v_cnt
  from (select uniq_pitch_id from pitch_log_seq where uniq_pitch_id > _after
        order by uniq_pitch_id limit _lim) b;
  if v_cnt = 0 then processed := 0; last_id := _after; return next; return; end if;
  update pitch_log p set
    pitch_num_in_game = s.pitch_num_in_game,
    ab_num_in_game    = s.ab_num_in_game,
    pitch_num_in_ab   = s.pitch_num_in_ab
  from pitch_log_seq s
  where p.uniq_pitch_id = s.uniq_pitch_id
    and s.uniq_pitch_id > _after and s.uniq_pitch_id <= v_last;
  processed := v_cnt; last_id := v_last; return next;
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
