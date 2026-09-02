-- Push 1 · pitch_log widen: add the ATTRIBUTION half so the single pitch_log table
-- carries everything dRS/bsrWAR consume (currently it holds only the tracking/shape half
-- from the 2026-06-24 re-export). Backfilled ADDITIVELY from docs/drs-reference/*.DRS Pitch
-- Log.csv by uniq_pitch_id (NOT via ingest_pitch_log.ts, which upserts full rows and would
-- NULL the extended-shape columns the DRS export lacks). Keep everything already present.
--
-- NOT added (already in the table): distance(=FBDst), spray_ang, x_avg, x_slg, x_woba,
-- exit_velocity, launch_angle, ivb, hb, spin, cs_prob(=probSL), pitch_result, outs, inn.

alter table pitch_log
  -- event attribution
  add column if not exists atbat_desc      text,     -- retrosheet event string (parser basis)
  -- fielder alignment (names; resolve chain positions -> player ids)
  add column if not exists first_baseman   text,
  add column if not exists second_baseman  text,
  add column if not exists third_baseman   text,
  add column if not exists short_stop      text,
  add column if not exists left_fielder    text,
  add column if not exists center_fielder  text,
  add column if not exists right_fielder   text,
  -- base-out state
  add column if not exists man_on_first    text,
  add column if not exists man_on_second   text,
  add column if not exists man_on_third    text,
  -- steal flags (0/1)
  add column if not exists sba2            smallint,
  add column if not exists sb2             smallint,
  add column if not exists sba3            smallint,
  add column if not exists sb3             smallint,
  -- framing / blocking
  add column if not exists p_pbwp_pct      numeric,  -- pPBWP% (passed-ball/wild-pitch prob)
  add column if not exists p_call_strk_pct numeric,  -- pCallStrk%
  -- catcher throwing / pop
  add column if not exists pop_time        numeric,
  add column if not exists deliv_time      numeric,
  add column if not exists c_time_to_base  numeric,
  add column if not exists c_throw_base    text,
  add column if not exists c_exch_time     numeric,
  add column if not exists pick_att_base   text,
  -- tracking gap + RE24 completeness
  add column if not exists hang_time       numeric,  -- HangTime (strip trailing 's' on load)
  add column if not exists runs            numeric;  -- per-play Runs (RE24 re-derivation)
