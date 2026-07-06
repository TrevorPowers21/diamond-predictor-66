import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, source_player_id, is_twp")
  .ilike("last_name", "%Overbeek%");
console.log("players:", JSON.stringify(players, null, 2));

for (const p of (players ?? [])) {
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("id, season, variant, customer_team_id, status, model_type, pitcher_role, hitter_depth_role, p_avg, p_obp, p_slg, p_wrc_plus, o_war, p_era, p_fip, p_rv_plus, p_war, market_value")
    .eq("player_id", p.id)
    .eq("season", 2027)
    .order("variant");
  console.log(`\n=== ${p.first_name} ${p.last_name} (2027 rows) ===`);
  console.log(JSON.stringify(preds, null, 2));
}
