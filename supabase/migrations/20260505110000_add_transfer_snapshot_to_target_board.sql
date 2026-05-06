-- Persist the transfer-simulation snapshot at add-time so the Target Board
-- and Team Builder display the same numbers the coach saw in the
-- TransferPortal simulator. Without this, the board only stored player_id
-- and downstream surfaces re-computed projections live with hardcoded
-- defaults (class_transition='SJ', dev_aggressiveness=0, destination =
-- whatever team is currently impersonated), which diverged from what the
-- simulator showed.
--
-- transfer_snapshot   — full simulated projection at add-time (jsonb).
--                        Shape: { p_avg, p_obp, p_slg, p_wrc_plus,
--                                 p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9,
--                                 p_rv_plus, p_war, owar, nil_valuation,
--                                 from_team, from_team_id, destination_team,
--                                 destination_team_id, class_transition,
--                                 dev_aggressiveness, captured_at }
-- destination_team    — display name of the team the simulation projected to
-- destination_team_id — Teams Table UUID for the destination (current season)
--
-- All nullable: a player added without going through the simulator (e.g.
-- from PlayerProfile or Dashboard "Add to Board") simply has no snapshot,
-- and the TB display falls back to live recompute as before.

ALTER TABLE public.target_board
  ADD COLUMN IF NOT EXISTS transfer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS destination_team text,
  ADD COLUMN IF NOT EXISTS destination_team_id uuid;
