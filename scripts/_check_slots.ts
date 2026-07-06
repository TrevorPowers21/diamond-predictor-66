import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, team, position, source_player_id, division, is_twp").ilike("first_name", "Landon").ilike("last_name", "Hairston").limit(3);
console.log("Landon Hairston player rows:", JSON.stringify(p, null, 2));
if (!p || p.length === 0) process.exit(0);
const PID = p[0].id;

const { data: rows } = await (sb as any).from("player_predictions").select("variant, model_type, customer_team_id, p_avg, p_obp, p_slg, p_wrc_plus, o_war, p_era, p_fip, p_whip, p_rv_plus, p_war, market_value").eq("player_id", PID).eq("season", 2027);
console.log(`\n${rows?.length ?? 0} prediction rows:`);
for (const r of rows ?? []) {
  const ct = r.customer_team_id ? r.customer_team_id.slice(0, 8) : "(global)";
  console.log(`  ${r.variant.padEnd(11)} ${r.model_type.padEnd(8)} team=${ct} | avg=${r.p_avg} obp=${r.p_obp} slg=${r.p_slg} wrc+=${r.p_wrc_plus} oWAR=${r.o_war} MV=${r.market_value}`);
}
