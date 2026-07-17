-- Enforce one slot value per player per draft year.
--
-- Matches the importer's upsert key (src/lib/importSlotValues.ts):
--   onConflict: "draft_year, player_name, current_school"
--
-- NULLS NOT DISTINCT is the critical part: players whose current_school is
-- NULL otherwise never match the conflict target (NULL != NULL in SQL), so
-- every re-import inserts a fresh row. That is exactly what produced the
-- War Room / Draft IQ duplicates (Costello / Rizy / Moutzouridis / Bell each
-- piled up 134 identical rows), cleaned up on prod 2026-06-30. With this
-- index the existing importer dedupes as designed, null-school players included.
--
-- Additive + idempotent. The table is already deduped, so the index builds clean.
CREATE UNIQUE INDEX IF NOT EXISTS player_slot_values_uniq
  ON public.player_slot_values (draft_year, player_name, current_school) NULLS NOT DISTINCT;
