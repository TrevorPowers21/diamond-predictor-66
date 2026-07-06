import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const rowIds = ["d5c7ac35-3506-479e-a9b0-7e36e5e08870", "146536cf-340c-4ff6-9d3c-abd2d4b2aa4f"];
console.log("=== Anderson's two flagged rows ===");
for (const id of rowIds) {
  const { data } = await (sb as any).from("player_predictions").select("id, player_id, season, variant, model_type, customer_team_id, status, hitter_depth_role, p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, updated_at, locked").eq("id", id).maybeSingle();
  console.log(`\nRow ${id}:`);
  console.log(JSON.stringify(data, null, 2));
}

console.log("\n=== ALL Anderson prediction rows (player_id 29edd467) ===");
const { data: all } = await (sb as any).from("player_predictions")
  .select("id, season, variant, model_type, customer_team_id, status, p_wrc_plus, o_war, market_value, updated_at")
  .eq("player_id", "29edd467-c5f1-4e64-9f78-d81e4e503c46")
  .order("season").order("variant");
console.log(`Total rows: ${all?.length}`);
for (const r of (all || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`  ${r.id.slice(0,8)} season=${r.season} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team} status=${r.status} | p_wrc+=${r.p_wrc_plus} o_war=${r.o_war?.toFixed(3)} MV=${r.market_value}`);
}
