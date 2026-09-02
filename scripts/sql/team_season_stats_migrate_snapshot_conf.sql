-- team_season_stats step 5 — carry team_war_snapshots history + migrate Conference Stats conf-scoped context.
-- (a) snapshot carry: proration/games_est/team_drs/champion flags/seed (join source_team_id=source_id). NOT the old oWAR (stale metric).
-- (b) conf context: conf Stuff+/HTP/run_env/OPR/wRC+ from "Conference Stats" via conference_id (same for all teams in a conference).

-- (a) snapshot carry
UPDATE public.team_season_stats ts SET
  proration_factor    = tws.proration_factor,
  games_played_est    = tws.games_played_est,
  team_drs            = tws.team_drs,
  is_national_champ   = coalesce(tws.is_national_champ, false),
  is_conference_champ = coalesce(tws.is_conference_champ, false),
  national_seed_rank  = tws.national_seed_rank
FROM public.team_war_snapshots tws
WHERE tws.source_team_id = ts.source_id AND tws.season = ts.season;

-- (b) conference-scoped context
UPDATE public.team_season_stats ts SET
  conf_stuff_plus = cs."Stuff_plus",
  conf_htp        = cs.hitter_talent_plus,
  run_env_factor  = cs.run_env_factor,
  conf_opr        = cs."Overall_Power_Rating",
  conf_wrc_plus   = cs."WRC_plus"
FROM "Conference Stats" cs
WHERE cs.conference_id = ts.conference_id AND cs.season = ts.season;
