-- =================================================================
-- Re-seed team_war_snapshots for 2025 — STABLE source_id keying
-- =================================================================
-- Fixes the lookup mismatch where Hitter Master."TeamID" is a per-season
-- uuid but Teams Table.source_id (which the app uses) is a stable
-- program-level ID (often a short numeric string). This re-seed joins
-- Hitter/Pitching Master → Teams Table by uuid and stores the stable
-- source_id as team_war_snapshots.source_team_id so Team Builder's
-- year-over-year lookup resolves via ID, not name fallback.
--
-- Safe to re-run — DELETEs then INSERTs the 2025 rows. Champion flag
-- UPDATEs at the bottom re-apply 2025 marks by joining to the same
-- stable source_id (so we don't have to track UUIDs that may rotate).
-- =================================================================

-- Step 0: Diagnostic — show what's in there NOW for Georgia (sanity check)
SELECT 'BEFORE RE-SEED' AS step,
  source_team_id, team_name, season
FROM team_war_snapshots
WHERE season = 2025 AND team_name ILIKE '%georgia%'
ORDER BY team_name;

-- Step 1: Clear 2025 rows so the re-seed cleanly re-keys them
DELETE FROM team_war_snapshots WHERE season = 2025;

-- Step 2: Re-aggregate + insert with stable source_id
INSERT INTO team_war_snapshots (
  season, source_team_id, team_name, conference,
  raw_total_owar, raw_total_pwar,
  raw_starting_lineup_owar, raw_rotation_pwar, raw_bullpen_pwar,
  prorated_total_owar, prorated_total_pwar,
  prorated_starting_lineup_owar, prorated_rotation_pwar, prorated_bullpen_pwar,
  games_played_est, proration_factor,
  n_hitters, n_pitchers
)
WITH hitter_war AS (
  SELECT
    -- Resolve to stable source_id via Teams Table join.
    -- If join fails (no Teams Table row), fall back to the raw TeamID text
    -- so the row is still seeded — name fallback will still match it.
    COALESCE(
      (SELECT t.source_id FROM "Teams Table" t WHERE t.id = hm."TeamID" LIMIT 1)::text,
      hm."TeamID"::text
    ) AS team_id,
    hm."Team" AS team_name,
    hm."Conference" AS conference,
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
    AND hm.pa IS NOT NULL AND hm.pa > 0
),
hitter_ranked AS (
  SELECT team_id, team_name, conference, owar,
    ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY owar DESC NULLS LAST) AS hitter_rank
  FROM hitter_war
),
hitter_totals AS (
  SELECT team_id, team_name, conference,
    COUNT(*) AS n_hitters,
    SUM(owar) AS total_owar,
    SUM(CASE WHEN hitter_rank <= 9 THEN owar ELSE 0 END) AS starting_lineup_owar
  FROM hitter_ranked
  GROUP BY team_id, team_name, conference
),
pitcher_war AS (
  SELECT
    COALESCE(
      (SELECT t.source_id FROM "Teams Table" t WHERE t.id = pm."TeamID" LIMIT 1)::text,
      pm."TeamID"::text
    ) AS team_id,
    pm."Team" AS team_name,
    pm."Conference" AS conference,
    pm."IP" AS ip,
    (
      ((
        (0.30 * COALESCE(pm.fip_pr_plus, 100) + 0.25 * COALESCE(pm.era_pr_plus, 100)
         + 0.15 * COALESCE(pm.whip_pr_plus, 100) + 0.15 * COALESCE(pm.k9_pr_plus, 100)
         + 0.10 * COALESCE(pm.bb9_pr_plus, 100) + 0.05 * COALESCE(pm.hr9_pr_plus, 100)
        ) - 100) / 100.0
        * (pm."IP" / 9.0) * 5.5
      )
      + (pm."IP" / 9.0 * 2.5)
    ) / 10 AS pwar
  FROM "Pitching Master" pm
  WHERE pm."Season" = 2025 AND pm."IP" IS NOT NULL AND pm."IP" > 0
),
pitcher_ranked AS (
  SELECT team_id, team_name, conference, ip, pwar,
    ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY ip DESC NULLS LAST) AS ip_rank
  FROM pitcher_war
),
pitcher_totals AS (
  SELECT team_id, team_name, conference,
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
    GREATEST(30, LEAST(80, ROUND(COALESCE(p.total_ip, 0)::numeric / 9.0)))::integer AS games_played_est,
    GREATEST(0.7, LEAST(1.5, 56.0 / NULLIF(GREATEST(30, LEAST(80, ROUND(COALESCE(p.total_ip, 0)::numeric / 9.0))), 0))) AS proration_factor
  FROM hitter_totals h
  FULL OUTER JOIN pitcher_totals p ON p.team_id = h.team_id
  WHERE COALESCE(h.team_name, p.team_name) IS NOT NULL
    AND COALESCE(h.team_id, p.team_id) IS NOT NULL
)
SELECT
  2025 AS season,
  source_team_id,
  team AS team_name,
  conference,
  ROUND(raw_total_owar::numeric, 2),
  ROUND(raw_total_pwar::numeric, 2),
  ROUND(raw_starting_lineup_owar::numeric, 2),
  ROUND(raw_rotation_pwar::numeric, 2),
  ROUND(raw_bullpen_pwar::numeric, 2),
  ROUND((raw_total_owar * proration_factor)::numeric, 2),
  ROUND((raw_total_pwar * proration_factor)::numeric, 2),
  ROUND((raw_starting_lineup_owar * proration_factor)::numeric, 2),
  ROUND((raw_rotation_pwar * proration_factor)::numeric, 2),
  ROUND((raw_bullpen_pwar * proration_factor)::numeric, 2),
  games_played_est,
  ROUND(proration_factor::numeric, 3),
  n_hitters,
  n_pitchers
FROM combined;

-- Step 3: Re-apply champion flags — find rows by team_name since source_team_id changed
UPDATE team_war_snapshots SET is_national_champ = false, is_conference_champ = false WHERE season = 2025;

UPDATE team_war_snapshots SET is_national_champ = true
  WHERE season = 2025 AND team_name ILIKE 'Louisiana State';

UPDATE team_war_snapshots SET is_conference_champ = true
WHERE season = 2025 AND team_name IN (
  'Florida State', 'Georgia Tech',
  'Austin Peay', 'Stetson',
  'Bryant',
  'UTSA',
  'Rhode Island',
  'West Virginia',
  'Connecticut', 'Creighton',
  'South Carolina Upstate',
  'Oregon', 'UCLA',
  'UC Irvine',
  'Dallas Baptist', 'Missouri State',
  'Northeastern',
  'Wright State',
  'Yale', 'Columbia',
  'Rider',
  'Kent State', 'Miami (OH)',
  'Murray State',
  'Nevada',
  'LIU Brooklyn',
  'Eastern Illinois',
  'Holy Cross',
  'Texas',
  'Bethune-Cookman',
  'East Tennessee State',
  'Southeastern Louisiana', 'UT Rio Grande Valley',
  'University of St. Thomas (Minn.)', 'Oral Roberts',
  'Coastal Carolina',
  'Abilene Christian', 'Sacramento State',
  'San Diego'
);

-- Step 4: Verification
SELECT 'AFTER RE-SEED' AS step,
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025) AS total_2025_rows,
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025 AND is_national_champ) AS national_champs,
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025 AND is_conference_champ) AS conf_champs;

-- Step 5: Verify Georgia specifically — confirm source_team_id matches Teams Table.source_id
SELECT
  tws.team_name, tws.source_team_id AS snapshot_source_id,
  t.source_id AS teams_table_source_id,
  t.abbreviation,
  CASE WHEN tws.source_team_id = t.source_id::text THEN 'MATCH ✓' ELSE 'MISMATCH ✗' END AS lookup_match
FROM team_war_snapshots tws
LEFT JOIN "Teams Table" t ON t.source_id::text = tws.source_team_id
WHERE tws.season = 2025 AND tws.team_name ILIKE '%georgia%'
ORDER BY tws.team_name;
