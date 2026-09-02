-- Dedupe player_slot_values, then enforce one row per player per draft year.
--
-- Fixes the War Room / Draft IQ duplicate rows. The importer
-- (src/lib/importSlotValues.ts) upserts on (draft_year, player_name,
-- current_school), but with no matching unique index, null-school players
-- re-inserted on every import. Two flavors of duplicate resulted:
--   1. exact dupes (same year/name/school) -- up to 134x per player
--   2. school-vs-null splits under one player_id (e.g. "LSU" + NULL)
--
-- We clean BOTH before adding the index so this is safe on ANY database:
-- prod was deduped by hand first, but staging / fresh rebuilds need the
-- cleanup baked in or CREATE UNIQUE INDEX would fail on dirty data.
-- Idempotent: on an already-clean DB the DELETEs are no-ops and the index
-- is skipped if it already exists.

-- Pass 1: collapse exact duplicates, keep the lowest id.
DELETE FROM public.player_slot_values
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY draft_year, player_name, current_school ORDER BY id
    ) AS rn
    FROM public.player_slot_values
  ) t WHERE rn > 1
);

-- Pass 2: collapse school-vs-null splits for matched players, keeping the
-- row that actually has a school (non-null current_school sorts first).
DELETE FROM public.player_slot_values
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY player_id, draft_year
      ORDER BY (current_school IS NULL), id
    ) AS rn
    FROM public.player_slot_values
    WHERE player_id IS NOT NULL
  ) t WHERE rn > 1
);

-- Enforce uniqueness so the importer's onConflict dedupes going forward.
-- NULLS NOT DISTINCT so null current_school rows collapse too.
CREATE UNIQUE INDEX IF NOT EXISTS player_slot_values_uniq
  ON public.player_slot_values (draft_year, player_name, current_school) NULLS NOT DISTINCT;
