-- pitch_log: add the PITCH/AT-BAT SEQUENCE columns from the DRS Pitch Log CSV that were never imported.
-- These order pitches within a game/half-inning — the prerequisite for running the score-driven ERA
-- calc (and any pitch-sequence logic) from the DB table instead of the CSVs. Backfilled ADDITIVELY from
-- docs/drs-reference/*.DRS Pitch Log.csv by uniq_pitch_id (same path as the Push 1 attribution widen).
alter table pitch_log
  add column if not exists pitch_num_in_game int,   -- pitchNumInGame — global pitch order within the game
  add column if not exists ab_num_in_game    int,   -- abNumInGame    — at-bat order within the game (PA ordering)
  add column if not exists pitch_num_in_ab   int;   -- pitchNumInAB   — pitch order within the at-bat
