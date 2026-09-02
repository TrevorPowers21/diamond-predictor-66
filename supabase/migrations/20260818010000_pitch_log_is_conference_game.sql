-- is_conference_game: true when batting team's conference == pitching team's conference
-- (an intra-conference game). Derived from team_id/opponent_id → "Teams Table".source_id
-- → conference_id. Enables the conf-vs-conf rate rollup with a trivial WHERE filter.
-- (batting_team_id/pitching_team_id are corrupt — team_id/opponent_id are the clean ids.)
alter table pitch_log add column if not exists is_conference_game boolean;
create index if not exists idx_pitch_log_is_conf_game on pitch_log (is_conference_game);
