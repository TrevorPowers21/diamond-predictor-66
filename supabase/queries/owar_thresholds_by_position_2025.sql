-- =================================================================
-- 2025 oWAR distribution by position — empirical thresholds for
-- the Team Builder Analytics WAR-by-Position card.
-- =================================================================
-- Replaces the hardcoded POS_STARTER_OWAR / POS_ELITE_OWAR constants
-- in src/pages/TeamBuilder.tsx with real D1 percentiles.
--
-- Reads: "Hitter Master" (2025 season)
-- Filter: PA >= 150 (regular-starter minimum — a D1 regular over a
--         56-game season averages 200-300 PA; 150 captures starters
--         who platoon or miss time without diluting w/ bench bats)
--
-- Reading the result columns:
--   p50_starter  → use as POS_STARTER_OWAR (the "is this a starter?" bar)
--   p90_elite    → use as POS_ELITE_OWAR   (the "elite-level starter?" bar)
--   p95_top      → reference only; top-of-conference outliers
-- =================================================================

WITH hitter_war AS (
  SELECT
    hm."Pos" AS raw_position,
    hm.pa,
    (
      ((((0.45 * hm."OBP" + 0.30 * hm."SLG" + 0.15 * hm."AVG" + 0.10 * hm."ISO") / 0.364) * 100 - 100) / 100.0
        * hm.pa * 0.13)
      + (hm.pa::float / 600 * 25)
    ) / 10 AS owar
  FROM "Hitter Master" hm
  WHERE hm."Season" = 2025
    AND hm."AVG" IS NOT NULL AND hm."OBP" IS NOT NULL
    AND hm."SLG" IS NOT NULL AND hm."ISO" IS NOT NULL
    AND hm.pa IS NOT NULL AND hm.pa >= 150
),
positioned AS (
  SELECT
    CASE UPPER(TRIM(raw_position))
      WHEN 'C'  THEN 'C'
      WHEN '1B' THEN '1B'
      WHEN '2B' THEN '2B'
      WHEN '3B' THEN '3B'
      WHEN 'SS' THEN 'SS'
      WHEN 'LF' THEN 'LF'
      WHEN 'CF' THEN 'CF'
      WHEN 'RF' THEN 'RF'
      WHEN 'DH' THEN 'DH'
      WHEN 'OF' THEN 'OF'
      WHEN 'IF' THEN 'IF'
      WHEN 'UTL' THEN 'UTL'
      WHEN 'UT'  THEN 'UTL'
      ELSE NULL
    END AS pos,
    owar,
    pa
  FROM hitter_war
)
SELECT
  pos,
  COUNT(*) AS n_players,
  ROUND(AVG(pa)::numeric, 0) AS avg_pa,
  ROUND(AVG(owar)::numeric, 2) AS avg_owar,
  ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY owar)::numeric, 2) AS p25_borderline,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY owar)::numeric, 2) AS p50_starter,
  ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY owar)::numeric, 2) AS p75_above_avg,
  ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY owar)::numeric, 2) AS p90_elite,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY owar)::numeric, 2) AS p95_top,
  ROUND(MAX(owar)::numeric, 2) AS max_owar
FROM positioned
WHERE pos IS NOT NULL
GROUP BY pos
ORDER BY CASE pos
  WHEN 'C'   THEN 1
  WHEN 'SS'  THEN 2
  WHEN 'CF'  THEN 3
  WHEN '2B'  THEN 4
  WHEN '3B'  THEN 5
  WHEN 'LF'  THEN 6
  WHEN 'RF'  THEN 7
  WHEN 'OF'  THEN 8
  WHEN '1B'  THEN 9
  WHEN 'DH'  THEN 10
  WHEN 'IF'  THEN 11
  WHEN 'UTL' THEN 12
  ELSE 99
END;
