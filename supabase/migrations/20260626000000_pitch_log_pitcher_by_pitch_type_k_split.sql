-- 2026-06-26 — Split strikeouts looking vs swinging per pitch type
--
-- Adds two columns so we can apply the proper terminal-K linear weight
-- (-0.243 per K) without double-counting it inside the per-pitch
-- called-strike (-0.066) or whiff (-0.118) averaged weights.
--
--   looking_strikeouts   — COUNT pitch_result = 'Strikeout (Looking)'
--   swinging_strikeouts  — COUNT pitch_result = 'Strikeout (Swinging)'
--
-- Combined with the existing walks_caused, hbps_caused, and
-- strikeouts_caused, this gives the full split of every terminal-pitch
-- event per pitch type — RV math can now use:
--   non-terminal balls (= balls − walks_caused) × +0.062
--   non-terminal CS    (= called_strikes − looking_Ks) × −0.066
--   non-terminal whiff (= whiffs − swinging_Ks) × −0.118
--   walks_caused × +0.319, HBPs × +0.732, Ks × −0.243, hits × hit weights

ALTER TABLE public.pitch_log_pitcher_by_pitch_type
  ADD COLUMN IF NOT EXISTS looking_strikeouts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swinging_strikeouts integer NOT NULL DEFAULT 0;
