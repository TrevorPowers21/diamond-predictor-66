import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Find a known D1 returner pitcher on staging with predictions
const { data: pitchers } = await (sb as any).from("players").select("id, first_name, last_name, source_player_id, team, position, ip, pa, is_twp").in("position", ["P","SP","RP"]).eq("is_twp", false).gte("ip", 30).limit(5);
console.log("Sample returner pitchers on staging:");
for (const p of (pitchers || [])) {
  console.log(`\n  ${p.first_name} ${p.last_name} (${p.team}, ${p.position}) ip=${p.ip} src=${p.source_player_id}`);
  const { data: preds } = await (sb as any).from("player_predictions")
    .select("variant, customer_team_id, model_type, p_era, p_fip, p_war, market_value, pitcher_role, projected_ip")
    .eq("player_id", p.id).eq("season", 2027);
  for (const r of (preds || [])) {
    const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
    console.log(`    ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} | role=${r.pitcher_role} era=${r.p_era?.toFixed(2)} pWar=${r.p_war?.toFixed(3) ?? "NULL"} MV=${r.market_value ?? "NULL"} ip=${r.projected_ip}`);
  }
}
