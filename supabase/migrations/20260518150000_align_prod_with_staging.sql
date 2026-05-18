-- Phase 2 Step 1 — align PROD schema with STAGING.
--
-- Scope (verified by tmp/preflight-audit.ts on 2026-05-18):
--   1. Renames: 4 cols on Hitter Master, 3 cols on Conference Stats
--      (misnomer fix — old "_plus" name actually held a derived power
--      rating, not an env rate; rename frees the name for the real env-rate
--      columns added in step 2 below)
--   2. New columns: division text NOT NULL DEFAULT 'D1' on six tables;
--      Pitching Master trackman fields; Teams Table region/district;
--      players data_status; Conference Stats env-rate columns
--   3. Unique indexes required for upsert idempotency in the JUCO data
--      migration script
--   4. Lookup indexes (division/district/region) — match staging exactly
--
-- Idempotency: every statement wrapped in IF EXISTS / IF NOT EXISTS checks
-- or DO $$ … $$ blocks so re-running is a no-op.
--
-- Reversibility: renames in this file have an inverse companion
-- 20260518150000_align_prod_with_staging_rollback.sql.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- §1. RENAMES (must run BEFORE the ADDs below — the renames free the
--     `ba_plus` / `obp_plus` / `iso_plus` names so they can be reused for
--     the new env-rate columns).
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- Hitter Master: 4 misnamed power-rating columns
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='ba_plus') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "ba_plus" TO "ba_power_rating";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='obp_plus') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "obp_plus" TO "obp_power_rating";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='iso_plus') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "iso_plus" TO "iso_power_rating";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='overall_plus') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "overall_plus" TO "overall_power_rating";
  END IF;

  -- Conference Stats: 3 misnamed columns (same misnomer fix)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='ba_plus') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "ba_plus" TO "ba_power_rating";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='obp_plus') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "obp_plus" TO "obp_power_rating";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='iso_plus') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "iso_plus" TO "iso_power_rating";
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- §2. NEW COLUMNS — division flag on six tables, plus per-table additions.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE "public"."Hitter Master"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1';

ALTER TABLE "public"."Pitching Master"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1',
  ADD COLUMN IF NOT EXISTS "trackman_pitches" integer,
  ADD COLUMN IF NOT EXISTS "k_pct" numeric,
  ADD COLUMN IF NOT EXISTS "bf" integer;

ALTER TABLE "public"."Teams Table"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1',
  ADD COLUMN IF NOT EXISTS "region" text,
  ADD COLUMN IF NOT EXISTS "district" text;

ALTER TABLE "public"."players"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1',
  ADD COLUMN IF NOT EXISTS "data_status" text;

-- data_status CHECK constraint (separate so it can be guarded with DO $$)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage
                 WHERE table_schema='public' AND table_name='players' AND constraint_name='players_data_status_check') THEN
    ALTER TABLE "public"."players"
      ADD CONSTRAINT "players_data_status_check"
      CHECK (data_status = ANY (ARRAY['complete'::text, 'partial'::text, 'no_data'::text, 'outlier'::text]));
  END IF;
END $$;

ALTER TABLE "public"."pitcher_stuff_plus_inputs"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1';

ALTER TABLE "public"."pitcher_stuff_plus_ncaa"
  ADD COLUMN IF NOT EXISTS "division" text NOT NULL DEFAULT 'D1';

-- Conference Stats env-rate columns (reuse the names freed by §1 renames).
ALTER TABLE "public"."Conference Stats"
  ADD COLUMN IF NOT EXISTS "ba_plus" numeric,
  ADD COLUMN IF NOT EXISTS "obp_plus" numeric,
  ADD COLUMN IF NOT EXISTS "slg_plus" numeric,
  ADD COLUMN IF NOT EXISTS "iso_plus" numeric;

-- ─────────────────────────────────────────────────────────────────────
-- §3. UNIQUE INDEXES — required for ON CONFLICT upsert idempotency in
--     the data-migration script.
-- Verified safe to create: prod has zero existing dupes on these keys.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "hitter_master_src_player_season_uniq"
  ON "public"."Hitter Master" USING btree ("source_player_id", "Season");

CREATE UNIQUE INDEX IF NOT EXISTS "pitching_master_src_player_season_uniq"
  ON "public"."Pitching Master" USING btree ("source_player_id", "Season");

CREATE UNIQUE INDEX IF NOT EXISTS "players_src_player_uniq"
  ON "public"."players" USING btree ("source_player_id");

CREATE UNIQUE INDEX IF NOT EXISTS "teams_table_src_season_uniq"
  ON "public"."Teams Table" USING btree ("source_id", "Season");

-- ─────────────────────────────────────────────────────────────────────
-- §4. LOOKUP INDEXES — match staging exactly (mostly division filters).
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_hitter_master_division"
  ON "public"."Hitter Master" USING btree ("division");

CREATE INDEX IF NOT EXISTS "idx_pitching_master_division"
  ON "public"."Pitching Master" USING btree ("division");

CREATE INDEX IF NOT EXISTS "idx_players_division"
  ON "public"."players" USING btree ("division");

CREATE INDEX IF NOT EXISTS "idx_pitcher_stuff_plus_inputs_division"
  ON "public"."pitcher_stuff_plus_inputs" USING btree ("division");

CREATE INDEX IF NOT EXISTS "idx_pitcher_stuff_plus_ncaa_division"
  ON "public"."pitcher_stuff_plus_ncaa" USING btree ("division");

CREATE INDEX IF NOT EXISTS "idx_teams_table_district"
  ON "public"."Teams Table" USING btree ("district");

CREATE INDEX IF NOT EXISTS "idx_teams_table_region"
  ON "public"."Teams Table" USING btree ("region");

COMMIT;
