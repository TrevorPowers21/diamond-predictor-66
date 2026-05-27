-- 2026 NCAA National Seeds + Regional Hosts → team_war_snapshots.national_seed_rank
--
-- Manual list locked 2026-05-27. Re-runnable / idempotent — sets rank for
-- listed teams, clears for everyone else in 2026.
--
-- Run via: supabase db query --linked --file supabase/queries/seed_national_seed_rank_2026.sql
--
-- Rank semantics:
--   1-8   → National seed (host through Super Regional)
--   9-16  → Regional host (host through Regional only)
--   NULL  → Unseeded

-- 0. Sanity check
SELECT COUNT(*) AS rows_2026 FROM team_war_snapshots WHERE season = 2026;

-- 1. Reset all 2026 seeds (idempotent)
UPDATE team_war_snapshots
SET national_seed_rank = NULL
WHERE season = 2026 AND national_seed_rank IS NOT NULL;

-- 2. Apply 2026 seeds 1-16. Keyed by exact source_team_id (verified 2026-05-27).
UPDATE team_war_snapshots SET national_seed_rank =  1 WHERE season=2026 AND source_team_id = '5048';        -- UCLA
UPDATE team_war_snapshots SET national_seed_rank =  2 WHERE season=2026 AND source_team_id = '100';         -- Georgia Tech
UPDATE team_war_snapshots SET national_seed_rank =  3 WHERE season=2026 AND source_team_id = '226';         -- Georgia
UPDATE team_war_snapshots SET national_seed_rank =  4 WHERE season=2026 AND source_team_id = '5466';        -- Auburn
UPDATE team_war_snapshots SET national_seed_rank =  5 WHERE season=2026 AND source_team_id = '730181888';   -- North Carolina
UPDATE team_war_snapshots SET national_seed_rank =  6 WHERE season=2026 AND source_team_id = '245';         -- Texas
UPDATE team_war_snapshots SET national_seed_rank =  7 WHERE season=2026 AND source_team_id = '730206976';   -- Alabama
UPDATE team_war_snapshots SET national_seed_rank =  8 WHERE season=2026 AND source_team_id = '730168320';   -- Florida
UPDATE team_war_snapshots SET national_seed_rank =  9 WHERE season=2026 AND source_team_id = '730246656';   -- Southern Miss
UPDATE team_war_snapshots SET national_seed_rank = 10 WHERE season=2026 AND source_team_id = '101';         -- Florida State
UPDATE team_war_snapshots SET national_seed_rank = 11 WHERE season=2026 AND source_team_id = '4807';        -- Oregon
UPDATE team_war_snapshots SET national_seed_rank = 12 WHERE season=2026 AND source_team_id = '3032';        -- Texas A&M
UPDATE team_war_snapshots SET national_seed_rank = 13 WHERE season=2026 AND source_team_id = '4865';        -- Nebraska
UPDATE team_war_snapshots SET national_seed_rank = 14 WHERE season=2026 AND source_team_id = '5080';        -- Mississippi State
UPDATE team_war_snapshots SET national_seed_rank = 15 WHERE season=2026 AND source_team_id = '730360064';   -- Kansas
UPDATE team_war_snapshots SET national_seed_rank = 16 WHERE season=2026 AND source_team_id = '5327';        -- West Virginia

-- 3. Verification: 16 rows expected, ranks 1-16 in order, no duplicates.
SELECT national_seed_rank, team_name, conference, source_team_id
FROM team_war_snapshots
WHERE season = 2026 AND national_seed_rank IS NOT NULL
ORDER BY national_seed_rank;

-- 4. Count check (expected: 16)
SELECT COUNT(*) AS seeded_rows
FROM team_war_snapshots
WHERE season = 2026 AND national_seed_rank IS NOT NULL;
