import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, pa, ip")
  .eq("first_name", "Michael")
  .eq("last_name", "Anderson")
  .eq("team", "Penn State")
  .maybeSingle();
console.log(data);
if (data) {
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("variant, customer_team_id, pitcher_role, hitter_depth_role, p_wrc_plus, o_war, p_rv_plus, p_war, p_era, market_value")
    .eq("player_id", data.id)
    .eq("season", 2027);
  console.log(`\n${preds?.length} prediction rows:`);
  for (const r of (preds || [])) {
    console.log(`  ${r.variant.padEnd(11)} | pitcher_role=${r.pitcher_role} hitter_depth_role=${r.hitter_depth_role} | pWRC+=${r.p_wrc_plus} oWAR=${r.o_war?.toFixed?.(2)} | pRV+=${r.p_rv_plus} pWAR=${r.p_war} pERA=${r.p_era} | market=$${r.market_value?.toFixed?.(0)}`);
  }
}
