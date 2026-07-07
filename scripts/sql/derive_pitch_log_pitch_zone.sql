-- Backfill pitch_zone (13-zone strike-zone label) for existing rows.
-- Matches zoneForPitch in src/savant/components/PitchZone*.tsx exactly:
--   in-zone unit square -> '1'..'9' (row0=top pz>1/3, col0=left px<-1/3),
--   outside -> 'UL'/'UR'/'LL'/'LR' by sign; |px|>4 or |pz|>4 excluded.
-- Idempotent via `pitch_zone IS NULL`. Run via exec_sql (900s) or paste with
-- SET statement_timeout='600s'. Going forward derive_pitch_log_flags.ts sets
-- this on ingest, so this is one-time per existing dataset (staging now,
-- prod later).
UPDATE public.pitch_log
SET pitch_zone = CASE
  WHEN px_norm >= -1 AND px_norm <= 1 AND pz_norm >= -1 AND pz_norm <= 1 THEN
    ( (CASE WHEN pz_norm > 1.0/3 THEN 0 WHEN pz_norm > -1.0/3 THEN 1 ELSE 2 END) * 3
      + (CASE WHEN px_norm < -1.0/3 THEN 0 WHEN px_norm < 1.0/3 THEN 1 ELSE 2 END)
      + 1 )::text
  WHEN px_norm <= 0 AND pz_norm >= 0 THEN 'UL'
  WHEN px_norm >= 0 AND pz_norm >= 0 THEN 'UR'
  WHEN px_norm <= 0 AND pz_norm <= 0 THEN 'LL'
  ELSE 'LR'
END
WHERE pitch_zone IS NULL
  AND px_norm IS NOT NULL AND pz_norm IS NOT NULL
  AND ABS(px_norm) <= 4 AND ABS(pz_norm) <= 4;
