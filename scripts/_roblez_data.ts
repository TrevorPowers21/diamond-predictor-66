import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const playerId = "03dd3c82-b85a-43a0-9815-89403d253a2e";
const { data: p } = await (sb as any).from("players").select("first_name, last_name, team, position, pa, ip, conference").eq("id", playerId).maybeSingle();
console.log(`${p.first_name} ${p.last_name} (${p.team}, ${p.position}, conf=${p.conference}, pa=${p.pa} ip=${p.ip})`);

const { data: preds } = await (sb as any).from("player_predictions")
  .select("id, variant, customer_team_id, model_type, status, p_era, p_fip, p_war, market_value, pitcher_role, projected_ip, p_rv_plus, class_transition")
  .eq("player_id", playerId).eq("season", 2027).order("variant").order("customer_team_id");
console.log(`\n2027 prediction rows:`);
for (const r of (preds || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`  ${r.id.slice(0,8)} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} | role=${r.pitcher_role} era=${r.p_era?.toFixed(2)} pWar=${r.p_war?.toFixed(3)} MV=${r.market_value?.toFixed(0)} ip=${r.projected_ip} ct=${r.class_transition}`);
}
