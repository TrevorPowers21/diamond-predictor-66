import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sids = ["1327017728","1299957248","1092652800","1055530746","1165176832"];
for (const sid of sids) {
  const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, team").eq("source_player_id", sid).maybeSingle();
  if (!p) continue;
  const { data: pred } = await (sb as any).from("player_predictions").select("from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_era, p_war, market_value, pitcher_role").eq("player_id", p.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
  console.log(`${p.first_name} ${p.last_name} (${p.team})`);
  console.log(`  from_era=${pred?.from_era ?? "NULL"} from_fip=${pred?.from_fip ?? "NULL"} from_whip=${pred?.from_whip ?? "NULL"} from_k9=${pred?.from_k9 ?? "NULL"}`);
  console.log(`  p_era=${pred?.p_era ?? "NULL"} p_war=${pred?.p_war?.toFixed(3) ?? "NULL"} MV=${pred?.market_value ?? "NULL"} role=${pred?.pitcher_role}`);
}
