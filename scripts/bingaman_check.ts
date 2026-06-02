import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: players } = await (sb as any).from("players").select("id, source_player_id, first_name, last_name, team_id, position").ilike("last_name", "%Bingaman%");
console.log("Players:", JSON.stringify(players, null, 2));

for (const p of players ?? []) {
  const sid = p.source_player_id;
  const pid = p.id;
  console.log(`\n=== ${p.first_name} ${p.last_name} (sid=${sid}, pid=${pid}) ===`);

  const { data: hm } = await (sb as any).from("Hitter Master").select("source_player_id, playerFullName, Team, Season, chase, chase_score").eq("source_player_id", sid).eq("Season", 2026);
  console.log("Hitter Master:", JSON.stringify(hm, null, 2));

  const { data: pp } = await (sb as any).from("player_predictions").select("player_id, customer_team_id, variant, season, chase, chase_score, blended_chase").eq("player_id", pid).eq("season", 2026);
  console.log("player_predictions:", JSON.stringify(pp, null, 2));
}
