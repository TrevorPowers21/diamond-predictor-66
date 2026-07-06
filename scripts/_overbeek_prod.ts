import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, source_player_id, pa, ip, ab")
  .ilike("last_name", "%Overbeek%");
console.log("=== PROD players matching Overbeek ===");
console.log(JSON.stringify(players, null, 2));

for (const p of (players ?? [])) {
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("id, season, variant, customer_team_id, status, model_type, pitcher_role, hitter_depth_role, p_avg, p_obp, p_slg, p_wrc_plus, o_war, p_era, p_fip, p_rv_plus, p_war, market_value, class_transition")
    .eq("player_id", p.id)
    .eq("season", 2027)
    .order("variant");
  console.log(`\n=== ${p.first_name} ${p.last_name} (is_twp=${p.is_twp}) — 2027 rows ===`);
  for (const r of (preds || [])) {
    const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
    console.log(`  ${r.variant.padEnd(11)} team=${team} model=${r.model_type} pitcher_role=${r.pitcher_role} hitter_depth=${r.hitter_depth_role} | p_wrc+=${r.p_wrc_plus} o_war=${r.o_war} | p_era=${r.p_era} p_war=${r.p_war} | MV=${r.market_value} ct=${r.class_transition}`);
  }
}
