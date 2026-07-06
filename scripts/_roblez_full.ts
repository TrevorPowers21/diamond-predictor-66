import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const playerId = "03dd3c82-b85a-43a0-9815-89403d253a2e";

const { data: p } = await (sb as any).from("players").select("*").eq("id", playerId).maybeSingle();
console.log("=== Roblez players row ===");
console.log(`class_year: ${p.class_year}, position: ${p.position}, division: ${p.division}, ip: ${p.ip}, source_id: ${p.source_player_id}`);

const { data: pred } = await (sb as any).from("player_predictions").select("*").eq("player_id", playerId).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
console.log("\n=== Regular global prediction row ===");
console.log(`class_transition=${pred?.class_transition} (overridden=${pred?.class_transition_overridden})`);
console.log(`scouting scores (legacy): contact=${pred?.contact_score} barrel=${pred?.barrel_score} ev=${pred?.ev_score} chase=${pred?.chase_score} whiff=${pred?.whiff_score} bb=${pred?.bb_score}`);
console.log(`scouting scores (domain): pitcher_whiff=${pred?.pitcher_whiff_score} pitcher_iz_whiff=${pred?.pitcher_iz_whiff_score} pitcher_barrel=${pred?.pitcher_barrel_score} pitcher_chase=${pred?.pitcher_chase_score} pitcher_ev=${pred?.pitcher_ev_score} pitcher_bb=${pred?.pitcher_bb_score}`);

// Pitching Master 2026 for ground truth
const { data: pm } = await (sb as any).from("Pitching Master").select("Role, G, GS, IP, ERA, miss_pct, in_zone_whiff_pct, chase_pct, barrel_pct, exit_vel, bb_pct").eq("source_player_id", p.source_player_id).eq("Season", 2026).maybeSingle();
console.log("\n=== Pitching Master 2026 ===");
console.log(`Role=${pm?.Role}, G=${pm?.G}, GS=${pm?.GS}, IP=${pm?.IP}, ERA=${pm?.ERA}`);
console.log(`miss=${pm?.miss_pct}, iz_whiff=${pm?.in_zone_whiff_pct}, chase=${pm?.chase_pct}, barrel=${pm?.barrel_pct}, ev=${pm?.exit_vel}, bb=${pm?.bb_pct}`);
