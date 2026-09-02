-- Phase C (Stuff+ prep) — add anchor-taxonomy tracking columns to pitch_log.
-- Ad-hoc gap: staging added these during the Stuff+ classifier rebuild (docs/STUFF_PLUS_RESUME_2026_08_17.md)
-- but there was no committed migration; prod was missing them. Reconstructed by diffing staging↔prod.
--   classification_version : stamps the reclassification version (e.g. 'v1-anchor-2026-08-17')
--   needs_review           : score-and-flag exceptions from the classifier (~9% on staging)
-- Idempotent. ADD COLUMN with no default is a metadata-only change (instant, no table rewrite).
alter table pitch_log add column if not exists classification_version text;
alter table pitch_log add column if not exists needs_review boolean;
