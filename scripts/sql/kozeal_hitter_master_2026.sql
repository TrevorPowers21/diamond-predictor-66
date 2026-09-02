-- Camden Kozeal (source_player_id 1925267789) — 2026 Hitter Master row MISSING on prod.
-- Seed columns only. DERIVED columns deliberately OMITTED so prod computes them itself:
--   contact_score, line_drive_score, avg_ev_score, pop_up_score, bb_score, chase_score, barrel_score, ev90_score, pull_score, la_score, gb_score, pull_air_score, ba_power_rating, obp_power_rating, iso_power_rating, overall_power_rating, desc_owar, wraa, woba, d_war, bsr_war, total_desc_war, woba_reg, wraa_reg, desc_owar_reg, d_war_reg, bsr_war_reg, total_desc_war_reg, trackman_pitches
-- TeamID/Team/Conference resolved from PROD's OWN Season-2026 "Teams Table" (NOT staging's, which carries the 2025 id).
-- Values cross-checked against prod's pitch log: AVG .321  OBP .411  SLG .658  (identical).
insert into "Hitter Master" ("source_player_id", "playerFullName", "Team", "TeamID", "Conference", "Season", "Pos", "BatHand", "ThrowHand", "AVG", "OBP", "SLG", "ISO", "contact", "line_drive", "avg_exit_velo", "pop_up", "bb", "chase", "barrel", "ev90", "pull", "la_10_30", "gb", "conference_id", "pa", "ab", "combined_used", "k_pct", "division", "pull_air")
values ('1925267789', 'Camden Kozeal', 'University of Arkansas', '5679ed85-eeea-4e47-be59-53ffc5087b38', 'SEC', 2026, '1B', 'L', 'R', 0.321, 0.411, 0.658, 0.337, 73.3, 22.8, 91.1, 10, 12.5, 25.9, 32.8, 107.3, 42.1, 31.7, 35.6, 'a3e6ae1f-d83b-4f0a-b454-5036420baa59', 289, 245, false, '18.8', 'D1', '19.5')
on conflict do nothing;

-- GATE (expect exactly 1 row, pa 289, Team 'University of Arkansas'):
select source_player_id, "playerFullName", "Team", "TeamID", pa, "AVG", "OBP", "SLG", division
from "Hitter Master" where "Season"=2026 and source_player_id='1925267789';
