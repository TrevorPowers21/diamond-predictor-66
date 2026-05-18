-- =================================================================
-- 2025 Team WAR Aggregation — with 56-game proration
-- =================================================================
-- Purpose: Seed data for `war_benchmarks` table. Aggregates total
-- oWAR and pWAR for every D1 team's 2025 season, plus positional
-- splits AND a 56-game prorated view so cross-conference comparisons
-- aren't distorted by schedule length (postseason teams play more
-- games, mid-majors with rainouts play fewer).
--
-- Formulas mirror src/savant/lib/war.ts:
--   wRC+ = ((0.45*OBP + 0.30*SLG + 0.15*AVG + 0.10*ISO) / 0.364) * 100
--   oWAR = (((wRC+ - 100)/100) * PA * 0.13 + (PA/600 * 25)) / 10
--   pRV+ = 0.30*FIP+ + 0.25*ERA+ + 0.15*WHIP+ + 0.15*K9+ + 0.10*BB9+ + 0.05*HR9+
--   pWAR = (((pRV+ - 100)/100) * (IP/9) * 5.5 + (IP/9 * 2.5)) / 10
--
-- Games played estimation:
--   games_played ≈ total_team_IP / 9
--   (every game has 9 defensive innings; extra innings + early stoppages
--   roughly cancel out at the team-season aggregate level)
--
-- Proration factor: 56 / games_played
--   - National champ played ~70 games → factor ~0.80 (scaled DOWN)
--   - Mid-major with rainouts played ~52 games → factor ~1.08 (scaled UP)
--   - Cap at 1.5 to avoid wild swings from small samples
--
-- Positional splits:
--   starting_lineup_owar = sum of oWAR for the team's top 9 hitters by oWAR
--   rotation_pwar        = sum of pWAR for the team's top 3 pitchers by IP
--   bullpen_pwar         = sum of pWAR for the team's remaining pitchers (rank 4+)
-- =================================================================

WITH hitter_war AS (
  SELECT
    "TeamID"::text AS team_id,
    "Team" AS team_name,
    "Conference" AS conference,
    pa,
    (
      ((((0.45 * "OBP" + 0.30 * "SLG" + 0.15 * "AVG" + 0.10 * "ISO") / 0.364) * 100 - 100) / 100.0
        * pa * 0.13)
      + (pa::float / 600 * 25)
    ) / 10 AS owar
  FROM "Hitter Master"
  WHERE "Season" = 2025
    AND "AVG" IS NOT NULL
    AND "OBP" IS NOT NULL
    AND "SLG" IS NOT NULL
    AND "ISO" IS NOT NULL
    AND pa IS NOT NULL
    AND pa > 0
),
hitter_ranked AS (
  SELECT
    team_id,
    team_name,
    conference,
    owar,
    ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY owar DESC NULLS LAST) AS hitter_rank
  FROM hitter_war
),
hitter_totals AS (
  SELECT
    team_id,
    team_name,
    conference,
    COUNT(*) AS n_hitters,
    SUM(owar) AS total_owar,
    SUM(CASE WHEN hitter_rank <= 9 THEN owar ELSE 0 END) AS starting_lineup_owar
  FROM hitter_ranked
  GROUP BY team_id, team_name, conference
),
pitcher_war AS (
  SELECT
    "TeamID"::text AS team_id,
    "Team" AS team_name,
    "Conference" AS conference,
    "IP" AS ip,
    (
      ((
        (0.30 * COALESCE(fip_pr_plus, 100)
         + 0.25 * COALESCE(era_pr_plus, 100)
         + 0.15 * COALESCE(whip_pr_plus, 100)
         + 0.15 * COALESCE(k9_pr_plus, 100)
         + 0.10 * COALESCE(bb9_pr_plus, 100)
         + 0.05 * COALESCE(hr9_pr_plus, 100)
        ) - 100) / 100.0
        * ("IP" / 9.0) * 5.5
      )
      + ("IP" / 9.0 * 2.5)
    ) / 10 AS pwar
  FROM "Pitching Master"
  WHERE "Season" = 2025
    AND "IP" IS NOT NULL
    AND "IP" > 0
),
pitcher_ranked AS (
  SELECT
    team_id,
    team_name,
    conference,
    ip,
    pwar,
    ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY ip DESC NULLS LAST) AS ip_rank
  FROM pitcher_war
),
pitcher_totals AS (
  SELECT
    team_id,
    team_name,
    conference,
    COUNT(*) AS n_pitchers,
    SUM(ip) AS total_ip,
    SUM(pwar) AS total_pwar,
    SUM(CASE WHEN ip_rank <= 3 THEN pwar ELSE 0 END) AS rotation_pwar,
    SUM(CASE WHEN ip_rank > 3 THEN pwar ELSE 0 END) AS bullpen_pwar
  FROM pitcher_ranked
  GROUP BY team_id, team_name, conference
),
combined AS (
  SELECT
    COALESCE(h.team_name, p.team_name) AS team,
    COALESCE(h.conference, p.conference) AS conference,
    COALESCE(h.team_id, p.team_id) AS source_team_id,
    COALESCE(h.total_owar, 0) AS raw_total_owar,
    COALESCE(p.total_pwar, 0) AS raw_total_pwar,
    COALESCE(h.starting_lineup_owar, 0) AS raw_starting_lineup_owar,
    COALESCE(p.rotation_pwar, 0) AS raw_rotation_pwar,
    COALESCE(p.bullpen_pwar, 0) AS raw_bullpen_pwar,
    COALESCE(p.total_ip, 0) AS total_ip,
    COALESCE(h.n_hitters, 0) AS n_hitters,
    COALESCE(p.n_pitchers, 0) AS n_pitchers,
    -- Games played proxy: total team IP / 9
    -- Capped between 30 (data sanity floor) and 80 (max realistic incl. postseason)
    GREATEST(30, LEAST(80, ROUND(COALESCE(p.total_ip, 0)::numeric / 9.0)))::numeric AS games_played_est,
    -- Proration factor: 56 / games_played, capped 0.7-1.5 to avoid extremes
    GREATEST(0.7, LEAST(1.5, 56.0 / NULLIF(GREATEST(30, LEAST(80, ROUND(COALESCE(p.total_ip, 0)::numeric / 9.0))), 0))) AS proration_factor
  FROM hitter_totals h
  FULL OUTER JOIN pitcher_totals p ON p.team_id = h.team_id
  WHERE COALESCE(h.team_name, p.team_name) IS NOT NULL
)
SELECT
  team,
  conference,
  source_team_id,
  -- RAW (actual 2025 totals, schedule-length dependent)
  ROUND(raw_total_owar::numeric, 2) AS raw_total_owar,
  ROUND(raw_total_pwar::numeric, 2) AS raw_total_pwar,
  ROUND((raw_total_owar + raw_total_pwar)::numeric, 2) AS raw_total_war,
  ROUND(raw_starting_lineup_owar::numeric, 2) AS raw_starting_lineup_owar,
  ROUND(raw_rotation_pwar::numeric, 2) AS raw_rotation_pwar,
  ROUND(raw_bullpen_pwar::numeric, 2) AS raw_bullpen_pwar,
  -- SCHEDULE INFO
  games_played_est,
  ROUND(proration_factor::numeric, 3) AS proration_factor,
  -- PRORATED to 56-game regular season (use these for cross-conf benchmarks)
  ROUND((raw_total_owar * proration_factor)::numeric, 2) AS prorated_owar_56,
  ROUND((raw_total_pwar * proration_factor)::numeric, 2) AS prorated_pwar_56,
  ROUND(((raw_total_owar + raw_total_pwar) * proration_factor)::numeric, 2) AS prorated_war_56,
  ROUND((raw_starting_lineup_owar * proration_factor)::numeric, 2) AS prorated_starting_lineup_owar_56,
  ROUND((raw_rotation_pwar * proration_factor)::numeric, 2) AS prorated_rotation_pwar_56,
  ROUND((raw_bullpen_pwar * proration_factor)::numeric, 2) AS prorated_bullpen_pwar_56,
  n_hitters,
  n_pitchers
FROM combined
ORDER BY prorated_war_56 DESC NULLS LAST;
