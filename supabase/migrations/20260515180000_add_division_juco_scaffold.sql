-- ─── JUCO exploration scaffold ──────────────────────────────────────────────
-- Adds `division` column to master tables + Teams/Conference/players, and a
-- `data_status` flag on players for flagging no-data / partial / outlier
-- profiles. Read paths haven't been updated yet — this migration is the
-- foundation for the JUCO branch's data ingestion work.
--
-- All `division` columns default to 'D1' so existing D1 data continues
-- to work without touching any queries. JUCO data will be loaded with
-- `division = 'JUCO'`; future divisions ('NAIA', 'D2', 'D3') just add
-- new values without schema changes.

-- Division column on master tables.
ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

ALTER TABLE "Conference Stats"
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

ALTER TABLE "Teams Table"
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

-- Population constants for Stuff+ are per (pitch_type, hand, season). JUCO
-- will need its own population (TrackMan coverage is sparser + JUCO pop is
-- distinct from D1). Adding division avoids polluting D1 pop with JUCO data.
ALTER TABLE pitcher_stuff_plus_ncaa
  ADD COLUMN IF NOT EXISTS division TEXT NOT NULL DEFAULT 'D1';

-- Data-quality flag on players. Used to surface players we can't reliably
-- evaluate (no game data, partial TrackMan coverage, outlier readings).
-- Mainly relevant for JUCO where TrackMan coverage is sparse, but useful
-- in D1 too (e.g., walk-ons with <5 PA).
--   complete  — full data, evaluable
--   partial   — has stats but missing Stuff+ inputs / scouting
--   no_data   — roster row exists but no game data at all
--   outlier   — extreme values vs population, flagged for review
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS data_status TEXT NULL
    CHECK (data_status IN ('complete', 'partial', 'no_data', 'outlier'));

-- Indexes for division-filtered reads on the hot tables. Read paths will
-- filter by division on most queries; without indexes, every full-table scan
-- on Hitter Master / Pitching Master gets slower as JUCO rows accumulate.
CREATE INDEX IF NOT EXISTS idx_hitter_master_division ON "Hitter Master" (division);
CREATE INDEX IF NOT EXISTS idx_pitching_master_division ON "Pitching Master" (division);
CREATE INDEX IF NOT EXISTS idx_players_division ON players (division);
CREATE INDEX IF NOT EXISTS idx_pitcher_stuff_plus_ncaa_division ON pitcher_stuff_plus_ncaa (division);
