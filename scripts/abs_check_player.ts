import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const playerId = process.argv[2];
const { data: player } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, source_player_id, is_twp, division")
  .eq("id", playerId)
  .maybeSingle();
console.log("player:", JSON.stringify(player, null, 2));

if (!player) process.exit(0);

for (const table of ["abs_hitter_stats", "abs_pitcher_stats"]) {
  console.log(`\n=== ${table} for source_player_id=${player.source_player_id} ===`);
  const { data, error } = await (sb as any)
    .from(table)
    .select("*")
    .eq("source_player_id", player.source_player_id);
  if (error) console.log("err:", error.message);
  console.log(JSON.stringify(data, null, 2));
}
