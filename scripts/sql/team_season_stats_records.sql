-- team_season_stats RECORDS (step 4) — derived from pitch_log game outcomes (NOT a player rollup).
-- Game key = DISTINCT (team_id, date, game_venue_id, total_runs, opponent_runs): splits doubleheaders by their distinct finals
-- (total_runs is the game final, constant per game; game_string/park_code are 0% populated so unavailable). team_id = source_id.
-- W/L from total_runs vs opponent_runs (ties excluded — 14 suspended/incomplete). Boundary 2026-05-18 (reg season).
--   w_total/l_total = all games ; w_reg/l_reg = date<=boundary ; w_conf/l_conf = reg-season conference (standings record).
-- Verified staging 2026-08-19: 308 teams avg 55 games; Georgia 53-14, Arkansas 41-22 (realistic).
WITH games AS (
  SELECT DISTINCT team_id, date::date d, game_venue_id, total_runs, opponent_runs, is_conference_game
  FROM pitch_log
  WHERE season=2026 AND team_id IS NOT NULL AND total_runs IS NOT NULL AND opponent_runs IS NOT NULL
),
rec AS (
  SELECT team_id sid,
    count(*) FILTER (WHERE total_runs>opponent_runs) w_total,
    count(*) FILTER (WHERE total_runs<opponent_runs) l_total,
    count(*) FILTER (WHERE total_runs>opponent_runs AND d<=DATE '2026-05-18') w_reg,
    count(*) FILTER (WHERE total_runs<opponent_runs AND d<=DATE '2026-05-18') l_reg,
    count(*) FILTER (WHERE total_runs>opponent_runs AND is_conference_game AND d<=DATE '2026-05-18') w_conf,
    count(*) FILTER (WHERE total_runs<opponent_runs AND is_conference_game AND d<=DATE '2026-05-18') l_conf
  FROM games GROUP BY team_id
)
UPDATE public.team_season_stats ts SET
  w_total=rec.w_total, l_total=rec.l_total,
  w_reg=rec.w_reg,     l_reg=rec.l_reg,
  w_conf=rec.w_conf,   l_conf=rec.l_conf
FROM rec WHERE ts.source_id=rec.sid AND ts.season=2026;
