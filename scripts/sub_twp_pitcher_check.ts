import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Look up Anderson specifically + scan for non-TWP players with both pa AND ip > 0
const { data: anderson } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, pa, ip")
  .ilike("last_name", "%Anderson%")
  .gte("ip", 1)
  .gte("pa", 25)
  .eq("is_twp", false);
console.log("=== Andersons with both pa+ip, is_twp=false ===");
console.log(JSON.stringify(anderson?.slice(0, 5), null, 2));

// Broader scan: any non-TWP with both PA and IP
const { data: hybrids, count } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, pa, ip", { count: "exact" })
  .eq("is_twp", false)
  .gte("ip", 1)
  .gte("pa", 25)
  .order("ip", { ascending: false })
  .limit(15);
console.log(`\n=== Top non-TWP players with both PA >= 25 and IP >= 1 (count=${count}) ===`);
console.log(JSON.stringify(hybrids, null, 2));

// Pick the highest-IP non-TWP and look at his prediction row
if (hybrids?.[0]) {
  const target = hybrids[0];
  console.log(`\n=== Inspecting ${target.first_name} ${target.last_name} (${target.team}, position=${target.position}, pa=${target.pa}, ip=${target.ip}) ===`);
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("id, customer_team_id, variant, model_type, status, pitcher_role, hitter_depth_role, p_avg, p_obp, p_slg, p_wrc_plus, o_war, p_era, p_fip, p_rv_plus, p_war, market_value")
    .eq("player_id", target.id)
    .eq("season", 2027)
    .order("variant");
  console.log(`Prediction rows: ${preds?.length}`);
  console.log(JSON.stringify(preds, null, 2));
}
