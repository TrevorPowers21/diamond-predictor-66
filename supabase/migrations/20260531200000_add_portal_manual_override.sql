-- Manual-override flag for admin-set portal status.
--
-- When true, the Verified Athletics importer (src/lib/importPortalEntries.ts)
-- preserves the player's portal_status / transfer_portal / portal_entry_date
-- / commit_school / commit_date columns on match. Bio + contact fields
-- (athletic_aid, contact_cell, contact_email, gpa, va_roster_link,
-- high_school, home_state) still update so VA continues to enrich the
-- player even while the status is held.
--
-- Cleared via the "held" button on AdminDashboard → Portal Override tab.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS portal_manual_override BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_players_portal_manual_override
  ON players (portal_manual_override)
  WHERE portal_manual_override = true;
