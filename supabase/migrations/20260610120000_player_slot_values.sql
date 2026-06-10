-- Player Slot Values — MLB Draft slot dollar values per draft-eligible player.
--
-- Combined hitter + pitcher in one table. Each row is one player's slot value
-- for a given draft cycle.
--
-- Coverage is mixed:
--   • College players already in our `players` table — linked via `player_id`
--   • High-school prospects not in `players` — `player_id` is NULL, identity
--     carried inline (player_name, current_school, commitment_school)
--
-- The HS prospect handling intentionally stays self-contained in this table
-- for now. Trevor wants to design a broader "non-DB committed players" view
-- after slot values land — what we capture here is enough to feed it later
-- (commitment_school + class_year + position).
--
-- `aggregate` is the industry aggregate score from Trevor's research sheet.
-- It is NOT a discrete rank — the value is stored and displayed as-is on the
-- profile under a "Rank" label.
--
-- `draft_year` is on every row so the table can hold multiple draft cycles
-- side-by-side. Annual refresh = drop in a CSV with the new draft_year.
--
-- Display priority: PlayerProfile / PitcherProfile first. Target Board +
-- Team Builder embedding is a follow-up. Combined Compare display is TBD.

CREATE TABLE player_slot_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  draft_year int NOT NULL,

  -- Link to players.id when the prospect is already in our DB (D1 / JUCO
  -- draft-eligible). NULL for high-school prospects and any unmatched rows.
  player_id uuid REFERENCES players(id) ON DELETE SET NULL,

  -- Identity (always populated, even when player_id is set, so the row is
  -- self-describing for direct CSV lookups and HS rows).
  player_name text NOT NULL,
  current_school text,                          -- where they currently play
  is_high_school boolean NOT NULL DEFAULT false,
  commitment_school text,                       -- HS only: where committed

  -- Display payload
  rank int,                                     -- ordinal rank (1, 2, 3...) derived from aggregate ascending
  aggregate numeric,                            -- industry aggregate score
  slot_value numeric NOT NULL,                  -- the $ amount

  -- Optional prospect metadata (HS rows usually carry more of this since
  -- they aren't backed by a players row)
  position text,
  bats_hand text,
  throws_hand text,
  class_year text,                              -- HS class ("2026", "2027")
  height text,
  weight int,

  source text,                                  -- attribution (MLB Pipeline, BA, etc.)
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Uniqueness on (draft_year, player_name, current_school) so HS rows with
  -- no player_id still dedupe cleanly across reimports.
  UNIQUE (draft_year, player_name, current_school)
);

CREATE INDEX idx_player_slot_values_player_id
  ON player_slot_values (player_id, draft_year)
  WHERE player_id IS NOT NULL;

CREATE INDEX idx_player_slot_values_draft_year
  ON player_slot_values (draft_year);

CREATE INDEX idx_player_slot_values_commitment
  ON player_slot_values (commitment_school)
  WHERE commitment_school IS NOT NULL;

COMMENT ON TABLE player_slot_values IS
  'MLB Draft slot dollar values per draft-eligible player. Combined hitter + pitcher. player_id is nullable for high-school prospects not yet in the players table. Display: PlayerProfile / PitcherProfile show "Rank: <aggregate> · Slot Value: $<slot_value>".';

-- RLS: read-for-authenticated only. No customer-team scoping at the DB layer;
-- display gating (if any) is enforced client-side.
ALTER TABLE player_slot_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_slot_values_read_authenticated"
  ON player_slot_values FOR SELECT
  TO authenticated
  USING (true);
