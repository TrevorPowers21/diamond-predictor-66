import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Justus Agosto on staging
const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, team, position, ip, source_player_id").eq("source_player_id", "1327017728").maybeSingle();
console.log(`${p.first_name} ${p.last_name} (${p.team}) — staging player_id: ${p.id}`);

const { data: preds } = await (sb as any).from("player_predictions")
  .select("id, season, variant, customer_team_id, model_type, status, p_era, p_fip, p_war, market_value, pitcher_role, projected_ip, p_rv_plus")
  .eq("player_id", p.id).eq("season", 2027).order("variant");
console.log(`\nAll 2027 prediction rows:`);
for (const r of (preds || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`  ${r.id.slice(0,8)} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} status=${r.status} | role=${r.pitcher_role} era=${r.p_era?.toFixed(2)} pWar=${r.p_war?.toFixed(3)} MV=${r.market_value?.toFixed(0)} ip=${r.projected_ip} rv+=${r.p_rv_plus?.toFixed(1)}`);
}
