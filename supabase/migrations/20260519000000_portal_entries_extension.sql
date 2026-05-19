-- Portal entries extension
--
-- Extends players table with Verified Athletics portal-specific fields and
-- adds an unmatched-entries staging table for admin review.
--
-- Run via: supabase db query --linked --file <path>

BEGIN;

-- Extend players with portal context + contact info
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "commit_school" text;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "commit_date" date;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "athletic_aid" text;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "contact_cell" text;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "contact_email" text;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "gpa" numeric;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "va_roster_link" text;
ALTER TABLE "public"."players" ADD COLUMN IF NOT EXISTS "portal_last_seen_at" timestamptz;

-- Index for withdrawal sweep + portal queries
CREATE INDEX IF NOT EXISTS "idx_players_portal_last_seen" ON "public"."players" ("portal_last_seen_at")
  WHERE "portal_status" = 'IN_PORTAL';

-- Unmatched portal entries — rows the importer couldn't confidently match
-- to a players row (ambiguous match, D2/D3 player not in our DB, or no
-- match at all). Surfaces in admin review screen.
CREATE TABLE IF NOT EXISTS "public"."portal_entries_unmatched" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "year_class" text,
  "division" text,
  "current_school" text,
  "position" text,
  "high_school" text,
  "home_state" text,
  "conference" text,
  "portal_entry_date" date,
  "commit_school" text,
  "commit_date" date,
  "athletic_aid" text,
  "contact_cell" text,
  "contact_email" text,
  "gpa" numeric,
  "va_roster_link" text,
  "reason" text NOT NULL,  -- 'ambiguous' | 'no_match' | 'lower_division'
  "candidate_player_ids" uuid[],  -- populated when reason='ambiguous'
  "resolved" boolean NOT NULL DEFAULT false,
  "resolved_player_id" uuid,
  "ingested_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_portal_unmatched_resolved" ON "public"."portal_entries_unmatched" ("resolved", "ingested_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_portal_unmatched_reason" ON "public"."portal_entries_unmatched" ("reason");

COMMIT;
