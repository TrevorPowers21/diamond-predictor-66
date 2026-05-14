-- =================================================================
-- Seed: team_war_snapshots for 2025 season
-- =================================================================
-- Idempotent — safe to re-run after season ends to refresh totals.
-- Champion flags re-applied each run from the hardcoded list below.
-- =================================================================

-- 1. Upsert aggregation results from the canonical query
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
    AND "AVG" IS NOT NULL AND "OBP" IS NOT NULL
    AND "SLG" IS NOT NULL AND "ISO" IS NOT NULL
    AND pa IS NOT NULL AND pa > 0
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
    "TeamID"::text AS team_id,
    "Team" AS team_name,
    "Conference" AS conference,
    "IP" AS ip,
    (
      ((
        (0.30 * COALESCE(fip_pr_plus, 100) + 0.25 * COALESCE(era_pr_plus, 100)
         + 0.15 * COALESCE(whip_pr_plus, 100) + 0.15 * COALESCE(k9_pr_plus, 100)
         + 0.10 * COALESCE(bb9_pr_plus, 100) + 0.05 * COALESCE(hr9_pr_plus, 100)
        ) - 100) / 100.0
        * ("IP" / 9.0) * 5.5
      )
      + ("IP" / 9.0 * 2.5)
    ) / 10 AS pwar
  FROM "Pitching Master"
  WHERE "Season" = 2025 AND "IP" IS NOT NULL AND "IP" > 0
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
FROM combined
ON CONFLICT (season, source_team_id) DO UPDATE SET
  team_name = EXCLUDED.team_name,
  conference = EXCLUDED.conference,
  raw_total_owar = EXCLUDED.raw_total_owar,
  raw_total_pwar = EXCLUDED.raw_total_pwar,
  raw_starting_lineup_owar = EXCLUDED.raw_starting_lineup_owar,
  raw_rotation_pwar = EXCLUDED.raw_rotation_pwar,
  raw_bullpen_pwar = EXCLUDED.raw_bullpen_pwar,
  prorated_total_owar = EXCLUDED.prorated_total_owar,
  prorated_total_pwar = EXCLUDED.prorated_total_pwar,
  prorated_starting_lineup_owar = EXCLUDED.prorated_starting_lineup_owar,
  prorated_rotation_pwar = EXCLUDED.prorated_rotation_pwar,
  prorated_bullpen_pwar = EXCLUDED.prorated_bullpen_pwar,
  games_played_est = EXCLUDED.games_played_est,
  proration_factor = EXCLUDED.proration_factor,
  n_hitters = EXCLUDED.n_hitters,
  n_pitchers = EXCLUDED.n_pitchers,
  computed_at = now();

-- 2. Reset all 2025 flags first (idempotent)
UPDATE team_war_snapshots SET is_national_champ = false, is_conference_champ = false WHERE season = 2025;

-- 3. National champ (1)
UPDATE team_war_snapshots SET is_national_champ = true
  WHERE season = 2025 AND source_team_id = 'f9d77db7-44cf-434a-aea3-7d90331e5dfd';  -- Louisiana State

-- 4. Conference champs (39 rows across 29 conferences, 10 split)
UPDATE team_war_snapshots SET is_conference_champ = true
WHERE season = 2025 AND source_team_id IN (
  -- ACC (split)
  'c8a8fc6b-f015-423d-a394-7073a80dcce5',  -- Florida State
  'd14244f0-8394-4c44-a832-fc89eb4c16a5',  -- Georgia Tech
  -- ASUN (split)
  'a4d168cb-8056-478f-b70d-e99db956b6de',  -- Austin Peay
  '96139383-bc3c-4a75-bc8d-ee0393cbfe24',  -- Stetson
  -- America East
  '97a65245-5b4f-4f5a-84da-f29f123a9eca',  -- Bryant
  -- American Athletic
  '3d6319b1-7d49-440b-aa4e-1590ac4105ac',  -- UTSA
  -- Atlantic 10
  '846e8989-c052-4e1e-b767-0d616a611fd6',  -- Rhode Island
  -- Big 12
  '33b78783-5736-4e14-ab95-0dcf21503184',  -- West Virginia
  -- Big East (split)
  '8872374a-a266-459b-8c3a-2f0c5d695d2d',  -- Connecticut
  '6927a1de-a7e3-4ef3-90ef-0b79ecb3a40d',  -- Creighton
  -- Big South
  '8ea764b9-5b0a-435d-ac43-cb2e5721c725',  -- South Carolina Upstate
  -- Big Ten (split)
  'b1e378b2-245f-40d1-9af5-3f15ab16e7f7',  -- Oregon
  'e0132acc-6222-47b3-a01e-3f0b4b63bc25',  -- UCLA
  -- Big West
  '3b8aa12e-4154-450f-8bec-639930506a6f',  -- UC Irvine
  -- CUSA (split)
  '5b324ef7-4d35-4088-aefe-b408f88d3d6c',  -- Dallas Baptist
  '44bfb3f2-7400-4c5c-b2b9-8b6769c508f2',  -- Missouri State
  -- CAA
  '0efb66d2-c98f-417e-9e50-1d02cda77db5',  -- Northeastern
  -- Horizon League
  '29114549-4e88-4cbd-b0e9-7cc7c6dcb0b2',  -- Wright State
  -- Ivy League (split)
  'fc67d316-a8c8-4e91-a3b5-78db8e1d6d95',  -- Yale
  '70ade9cb-dfe1-4fb4-a056-0d92d6c2534c',  -- Columbia
  -- MAAC
  '82f09881-ecf0-4c33-a044-c4b129517f45',  -- Rider
  -- MAC (split)
  '731bc132-4825-426e-9a3f-0d8eb6720997',  -- Kent State
  '161c0640-c2fb-43a6-929b-5577eeb6a16f',  -- Miami (OH)
  -- MVC
  '5ab7305c-a5e0-4e97-94bf-a1517093bf40',  -- Murray State
  -- Mountain West
  '1c19191c-fbdc-4e70-8fdb-cf923efd054f',  -- Nevada
  -- NEC
  'cc20a09d-de9d-49f9-aaf7-9038f8101c67',  -- LIU Brooklyn
  -- OVC
  'efccd5c2-6588-4ebe-8e98-01cd60d43bc8',  -- Eastern Illinois
  -- Patriot League
  '07b2df00-56fb-442f-b7b5-af4b47487961',  -- Holy Cross
  -- SEC
  '99197536-dc60-4df0-9115-94600b6ff14e',  -- Texas
  -- SWAC
  'f043b46a-84a5-4435-8526-91bc280eeb75',  -- Bethune-Cookman
  -- SoCon
  'fe673f71-e208-44de-a29a-54df99936788',  -- East Tennessee State
  -- Southland (split)
  '999732f6-1c1b-4574-9a84-bdb35dd61d68',  -- Southeastern Louisiana
  '5e288273-08ed-4b35-801b-05cf46cc44a4',  -- UT Rio Grande Valley
  -- Summit League (split)
  'f9d323c6-20aa-4277-a9ee-6bb889666723',  -- University of St. Thomas (Minn.)
  'c232bbcc-999a-4ed9-9cb4-ef2e2ddc5f6e',  -- Oral Roberts
  -- Sun Belt
  'b291bfe9-9ec6-4a69-a369-960322492b59',  -- Coastal Carolina
  -- WAC (split)
  '7207bb03-de70-4447-9353-59c8bbc26bca',  -- Abilene Christian
  '61dd676b-9613-4b2d-bc32-9271784c6a36',  -- Sacramento State
  -- WCC
  '3044a2c9-e6ac-4dcd-9a6d-b83720e4316f'   -- San Diego
);

-- 5. Verification
SELECT
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025) AS total_2025_rows,
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025 AND is_national_champ) AS national_champs,
  (SELECT COUNT(*) FROM team_war_snapshots WHERE season = 2025 AND is_conference_champ) AS conf_champs;
