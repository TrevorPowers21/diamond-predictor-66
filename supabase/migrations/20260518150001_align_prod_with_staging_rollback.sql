-- Rollback companion for 20260518150000_align_prod_with_staging.sql
--
-- Reverses the renames (recreates the misnomer) so a code revert that
-- expects the old `ba_plus` column names can still find them. Idempotent.
--
-- Note: the ADD COLUMN and CREATE INDEX statements in the forward migration
-- are intentionally NOT rolled back here — they're nullable additions that
-- don't break anything when left in place, and `DROP COLUMN` would lose any
-- env-rate data written between the forward migration and the rollback.

BEGIN;

DO $$
BEGIN
  -- Conference Stats: revert renames. Must run BEFORE Hitter Master in case
  -- the new env-rate `ba_plus` columns were added and need to be dropped
  -- first to free the name.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='ba_plus') THEN
    -- New env-rate column exists; must drop before we can rename back
    ALTER TABLE "public"."Conference Stats" DROP COLUMN "ba_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='ba_power_rating') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "ba_power_rating" TO "ba_plus";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='obp_plus') THEN
    ALTER TABLE "public"."Conference Stats" DROP COLUMN "obp_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='obp_power_rating') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "obp_power_rating" TO "obp_plus";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='iso_plus') THEN
    ALTER TABLE "public"."Conference Stats" DROP COLUMN "iso_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='iso_power_rating') THEN
    ALTER TABLE "public"."Conference Stats" RENAME COLUMN "iso_power_rating" TO "iso_plus";
  END IF;

  -- slg_plus only exists post-migration; safe to drop
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Conference Stats' AND column_name='slg_plus') THEN
    ALTER TABLE "public"."Conference Stats" DROP COLUMN "slg_plus";
  END IF;

  -- Hitter Master: revert renames (no env-rate column set to clear)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='ba_power_rating') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "ba_power_rating" TO "ba_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='obp_power_rating') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "obp_power_rating" TO "obp_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='iso_power_rating') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "iso_power_rating" TO "iso_plus";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='Hitter Master' AND column_name='overall_power_rating') THEN
    ALTER TABLE "public"."Hitter Master" RENAME COLUMN "overall_power_rating" TO "overall_plus";
  END IF;
END $$;

COMMIT;
