import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: player } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, source_player_id")
  .eq("id", "bc4e78f2-886d-47cb-94f8-509873aba471")
  .maybeSingle();
console.log("player:", JSON.stringify(player, null, 2));

if (player) {
  const { data: rows } = await (sb as any)
    .from("player_predictions")
    .select("id, season, variant, customer_team_id, status, from_era, p_era, p_war, market_value, p_rv_plus")
    .eq("player_id", player.id)
    .order("season", { ascending: true });
  console.log(`\nAll prediction rows (${rows?.length}):`);
  console.log(JSON.stringify(rows, null, 2));
}
