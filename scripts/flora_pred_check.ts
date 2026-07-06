import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1. Find Flora's player_id
const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, source_player_id")
  .ilike("last_name", "%Flora%");
console.log("Flora players row:", JSON.stringify(players, null, 2));

if (!players?.[0]) process.exit(0);
const pid = players[0].id;

// 2. Fetch his prediction rows incl from_*
const { data: preds } = await (sb as any)
  .from("player_predictions")
  .select("id, customer_team_id, variant, model_type, status, season, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_era, p_fip, p_war, p_rv_plus, market_value, pitcher_role")
  .eq("player_id", pid)
  .eq("season", 2026);

console.log(`\nFlora prediction rows (count=${preds?.length}):`);
console.log(JSON.stringify(preds, null, 2));
