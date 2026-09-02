-- Push 1 · pitch_log widen + dedup + additive attribution backfill (STAGING).
-- Run STEP 1, then the loader (scripts/backfill_pitch_log_attribution.mjs --apply),
-- then STEP 2. Path (a): temp table + server-side UPDATE...FROM (additive; never
-- touches the existing shape/tracking columns).

-- ============================ STEP 1 — before the loader ============================
-- (1a) widen pitch_log — same as 20260806_pitch_log_widen_attribution.sql
alter table pitch_log
  add column if not exists atbat_desc text,
  add column if not exists first_baseman text, add column if not exists second_baseman text,
  add column if not exists third_baseman text, add column if not exists short_stop text,
  add column if not exists left_fielder text, add column if not exists center_fielder text,
  add column if not exists right_fielder text,
  add column if not exists man_on_first text, add column if not exists man_on_second text,
  add column if not exists man_on_third text,
  add column if not exists sba2 smallint, add column if not exists sb2 smallint,
  add column if not exists sba3 smallint, add column if not exists sb3 smallint,
  add column if not exists p_pbwp_pct numeric, add column if not exists p_call_strk_pct numeric,
  add column if not exists pop_time numeric, add column if not exists deliv_time numeric,
  add column if not exists c_time_to_base numeric, add column if not exists c_throw_base text,
  add column if not exists c_exch_time numeric, add column if not exists pick_att_base text,
  add column if not exists hang_time numeric, add column if not exists runs numeric;

-- (1b) temp landing table the loader fills (one row per uniq_pitch_id)
drop table if exists pitch_log_attr;
create table pitch_log_attr (
  uniq_pitch_id text primary key,
  atbat_desc text,
  first_baseman text, second_baseman text, third_baseman text, short_stop text,
  left_fielder text, center_fielder text, right_fielder text,
  man_on_first text, man_on_second text, man_on_third text,
  sba2 smallint, sb2 smallint, sba3 smallint, sb3 smallint,
  p_pbwp_pct numeric, p_call_strk_pct numeric,
  pop_time numeric, deliv_time numeric, c_time_to_base numeric, c_throw_base text,
  c_exch_time numeric, pick_att_base text, hang_time numeric, runs numeric
);

-- >>> now run: node scripts/backfill_pitch_log_attribution.mjs --apply

-- ============================ STEP 2 — after the loader ============================
-- (2a) dedup pitch_log to one row per uniq_pitch_id (keep an arbitrary survivor)
delete from pitch_log a using pitch_log b
where a.ctid < b.ctid and a.uniq_pitch_id = b.uniq_pitch_id;

-- (2b) the durable dupe fix — makes overlapping-window reloads a no-op
alter table pitch_log add constraint pitch_log_uniq_pitch_id_key unique (uniq_pitch_id);

-- (2c) ADDITIVE backfill: copy ONLY the attribution columns by uniq_pitch_id
update pitch_log p set
  atbat_desc = a.atbat_desc,
  first_baseman = a.first_baseman, second_baseman = a.second_baseman,
  third_baseman = a.third_baseman, short_stop = a.short_stop,
  left_fielder = a.left_fielder, center_fielder = a.center_fielder, right_fielder = a.right_fielder,
  man_on_first = a.man_on_first, man_on_second = a.man_on_second, man_on_third = a.man_on_third,
  sba2 = a.sba2, sb2 = a.sb2, sba3 = a.sba3, sb3 = a.sb3,
  p_pbwp_pct = a.p_pbwp_pct, p_call_strk_pct = a.p_call_strk_pct,
  pop_time = a.pop_time, deliv_time = a.deliv_time, c_time_to_base = a.c_time_to_base,
  c_throw_base = a.c_throw_base, c_exch_time = a.c_exch_time, pick_att_base = a.pick_att_base,
  hang_time = a.hang_time, runs = a.runs
from pitch_log_attr a
where p.uniq_pitch_id = a.uniq_pitch_id;

-- (2d) verify, then drop the temp table
select
  count(*)                                as pitch_log_rows,
  count(*) filter (where atbat_desc is not null) as with_atbat_desc,
  count(*) filter (where short_stop  is not null) as with_shortstop,
  count(*) filter (where hang_time   is not null) as with_hangtime
from pitch_log;
-- expect pitch_log_rows ≈ 2,576,230 (post-dedup) and the attribution counts to match
-- pitch_log_attr's loaded count on the BIP/relevant subset.

drop table pitch_log_attr;
