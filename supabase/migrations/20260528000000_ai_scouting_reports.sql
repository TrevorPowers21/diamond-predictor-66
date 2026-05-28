-- AI-generated scouting reports.
--
-- One row per player (hitter or pitcher). Generated in bulk by
-- scripts/generate-scouting-reports.ts from a structured ScoutingContext
-- built in src/lib/scoutingContext.ts. Reports are stable — data refreshes
-- only on full Master regeneration, so there is no in-app refresh path.
--
-- input_hash makes re-runs idempotent: if a player's source data hasn't
-- changed since the last report, the bulk script skips them.
--
-- JUCO players are not generated (data too limited). The bulk script filters
-- them upstream; this table has no JUCO-specific constraint.

CREATE TABLE IF NOT EXISTS ai_scouting_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      uuid        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  side           text        NOT NULL CHECK (side IN ('hitter', 'pitcher')),
  archetype_id   text        NOT NULL,
  body           text        NOT NULL,
  model          text        NOT NULL,
  input_hash     text        NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  -- One report per (player, side). Two-way players get separate hitter +
  -- pitcher reports.
  UNIQUE (player_id, side)
);

COMMENT ON TABLE  ai_scouting_reports IS 'AI-generated scouting reports, one per (player, side). Generated in bulk via scripts/generate-scouting-reports.ts.';
COMMENT ON COLUMN ai_scouting_reports.side IS 'hitter or pitcher. TWPs may have one of each.';
COMMENT ON COLUMN ai_scouting_reports.archetype_id IS 'Internal archetype label from src/lib/scoutingArchetypes.ts. Not user-facing.';
COMMENT ON COLUMN ai_scouting_reports.body IS 'Generated report prose (markdown allowed). Coach-facing.';
COMMENT ON COLUMN ai_scouting_reports.model IS 'Anthropic model id used (e.g., claude-haiku-4-5-20251001).';
COMMENT ON COLUMN ai_scouting_reports.input_hash IS 'SHA-256 of the ScoutingContext input. Skip regeneration when unchanged.';

CREATE INDEX IF NOT EXISTS idx_ai_scouting_reports_player
  ON ai_scouting_reports (player_id);

-- RLS: authenticated users read; only service role writes.
ALTER TABLE ai_scouting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_scouting_reports_read_authenticated"
  ON ai_scouting_reports FOR SELECT
  TO authenticated
  USING (true);
