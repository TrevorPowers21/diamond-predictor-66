-- Add game_string + park_code to pitch_log.
-- gameString = `cs-<parkCode><date(8)><game#(1)>`; park_code (strip trailing 9
-- digits + `cs-`) is the STABLE physical-stadium id (game_venue_id fragments per
-- weekend series). Used for pitch-log-derived park factors, keyed park_code + team_id.
-- (batting_team_id/pitching_team_id are corrupt in the source — use team_id/opponent_id.)
alter table pitch_log add column if not exists game_string text;
alter table pitch_log add column if not exists park_code text;
create index if not exists idx_pitch_log_park_code on pitch_log (park_code);
