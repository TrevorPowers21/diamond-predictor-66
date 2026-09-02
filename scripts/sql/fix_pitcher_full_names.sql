-- Phase C step 19 — fix corrupt pitch_log.pitcher_full_name (holds the BATTER name).
-- Sets it to the real pitcher name from players via pitcher_id = source_player_id.
-- Validated: reproduces staging's pitcher_full_name exactly (30/30). One bulk UPDATE with a
-- raised statement_timeout (SET LOCAL override confirmed working through exec_sql). Reconstruction
-- of the runbook's ad-hoc "_pitcher_name_fix + fix_pnames" — committed to close the gap.
-- Rows whose pitcher_id has no matching player are left unchanged (nothing to map them to).
set local statement_timeout = '900s';
update pitch_log pl
set pitcher_full_name = trim(p.first_name || ' ' || p.last_name)
from players p
where p.source_player_id = pl.pitcher_id
  and pl.season = 2026
  and pl.pitcher_full_name is distinct from trim(p.first_name || ' ' || p.last_name);
