import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const [label, sb] of [["STAGING", STAGING], ["PROD", PROD]] as const) {
  console.log(`\n=== ${label} ===`);
  const { data: players } = await (sb as any)
    .from("players")
    .select("id, first_name, last_name, team, position, class_year, source_player_id")
    .ilike("last_name", "%Grindlinger%");
  console.log("players row:");
  console.log(JSON.stringify(players, null, 2));

  if (players?.[0]) {
    const { data: preds } = await (sb as any)
      .from("player_predictions")
      .select("season, variant, model_type, customer_team_id, status, class_transition, dev_aggressiveness, updated_at")
      .eq("player_id", players[0].id)
      .eq("season", 2027)
      .order("variant");
    console.log(`\nGrindlinger 2027 prediction rows (count=${preds?.length}):`);
    for (const r of (preds || [])) {
      console.log(`  ${r.variant.padEnd(11)} model=${r.model_type} team=${r.customer_team_id?.slice(0,8) ?? "(global)"} status=${r.status} class_transition=${r.class_transition} dev_agg=${r.dev_aggressiveness}`);
    }
  }
}
