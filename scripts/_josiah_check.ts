import { createClient } from "@supabase/supabase-js";
const ST = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PR = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const [label, sb] of [["STAGING", ST], ["PROD", PR]] as const) {
  console.log(`\n=== ${label} ===`);
  const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, position, pa, ip, is_twp, conference, division").eq("source_player_id", "1440627828").maybeSingle();
  console.log(`Josiah players: ${JSON.stringify(p)}`);
  if (!p) continue;
  const { data: preds } = await (sb as any).from("player_predictions").select("variant, customer_team_id, model_type, p_wrc_plus, o_war, p_war, market_value, hitter_depth_role, pitcher_role").eq("player_id", p.id).eq("season", 2027);
  console.log(`\nJosiah ${label} prediction rows:`);
  for (const r of (preds || [])) {
    const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
    console.log(`  ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} | wrc+=${r.p_wrc_plus} oWar=${r.o_war?.toFixed(3)} | pWar=${r.p_war?.toFixed(3)} | MV=${r.market_value?.toFixed(0)} | hitter_depth=${r.hitter_depth_role} pitcher_role=${r.pitcher_role}`);
  }
}
