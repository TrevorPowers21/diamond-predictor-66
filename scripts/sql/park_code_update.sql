-- Phase C step 20 finisher — UPDATE pitch_log.park_code from _park_code_fix (loaded by
-- backfill_park_code_load.ts). Raised timeout; single clean run (no competing UPDATEs).
set local statement_timeout = '1800s';
update pitch_log pl
set park_code = f.park_code
from _park_code_fix f
where f.uniq_pitch_id = pl.uniq_pitch_id
  and pl.park_code is distinct from f.park_code;
