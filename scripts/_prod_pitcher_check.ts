import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// Same pitcher source ids
const sids = ["1327017728","1299957248","1092652800","1055530746","1165176832"];
for (const sid of sids) {
  const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, team, position, ip, is_twp").eq("source_player_id", sid).maybeSingle();
  if (!p) continue;
  const { data: pred } = await (sb as any).from("player_predictions").select("p_era, p_war, market_value, pitcher_role, projected_ip").eq("player_id", p.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
  console.log(`${p.first_name} ${p.last_name} (${p.team}) | role=${pred?.pitcher_role} era=${pred?.p_era ?? "NULL"} pWar=${pred?.p_war?.toFixed(3) ?? "NULL"} MV=${pred?.market_value ?? "NULL"}`);
}
