-- =================================================================
-- 2025 pWAR distribution by role bucket — empirical thresholds for
-- the Team Builder Analytics Pitcher elite cap.
-- =================================================================
-- Replaces the hand-set SP_ELITE_PWAR = 1.5 / RP_ELITE_PWAR = 0.8
-- constants in src/pages/TeamBuilder.tsx with real D1 percentiles.
--
-- Reads: "Pitching Master" (2025 season)
-- Role bucketing: rank within team by IP (matches the snapshot logic
-- that already classifies rotation = top 3 IP per team).
--   - SP_rotation        : top 3 IP per team        → weekend SP elite
--   - RP_primary         : ranks 4-7 per team       → high-leverage RP
--   - RP_depth           : rank 8+ per team         → mid/low/specialist
-- Filter: IP >= 5 (excludes one-appearance noise)
-- =================================================================

WITH pitcher_war AS (
  SELECT
    pm."TeamID" AS team_id,
    pm."IP" AS ip,
    (
      (((0.30 * COALESCE(pm.fip_pr_plus, 100) + 0.25 * COALESCE(pm.era_pr_plus, 100)
         + 0.15 * COALESCE(pm.whip_pr_plus, 100) + 0.15 * COALESCE(pm.k9_pr_plus, 100)
         + 0.10 * COALESCE(pm.bb9_pr_plus, 100) + 0.05 * COALESCE(pm.hr9_pr_plus, 100)
        ) - 100) / 100.0
        * (pm."IP" / 9.0) * 5.5
      )
      + (pm."IP" / 9.0 * 2.5)
    ) / 10 AS pwar
  FROM "Pitching Master" pm
  WHERE pm."Season" = 2025
    AND pm."IP" IS NOT NULL AND pm."IP" >= 5
),
ranked AS (
  SELECT
    ip, pwar,
    ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY ip DESC NULLS LAST) AS ip_rank
  FROM pitcher_war
),
classified AS (
  SELECT
    CASE
      WHEN ip_rank <= 3 THEN 'SP_rotation'
      WHEN ip_rank <= 7 THEN 'RP_primary'
      ELSE 'RP_depth'
    END AS role_bucket,
    ip,
    pwar
  FROM ranked
)
SELECT
  role_bucket,
  COUNT(*) AS n_pitchers,
  ROUND(AVG(ip)::numeric, 1) AS avg_ip,
  ROUND(AVG(pwar)::numeric, 2) AS avg_pwar,
  ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY pwar)::numeric, 2) AS p25_borderline,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY pwar)::numeric, 2) AS p50_starter,
  ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY pwar)::numeric, 2) AS p75_above_avg,
  ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY pwar)::numeric, 2) AS p90_elite,
  ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY pwar)::numeric, 2) AS p95_top,
  ROUND(MAX(pwar)::numeric, 2) AS max_pwar
FROM classified
GROUP BY role_bucket
ORDER BY CASE role_bucket
  WHEN 'SP_rotation' THEN 1
  WHEN 'RP_primary' THEN 2
  WHEN 'RP_depth'   THEN 3
END;
