import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const rowId = "ba5b7252-564f-4275-9c22-0008aba5c8a9";
const { data: row } = await (sb as any).from("player_predictions").select("*").eq("id", rowId).maybeSingle();
console.log(`Row ${rowId}:`);
console.log(JSON.stringify(row, null, 2));

if (row?.player_id) {
  const { data: p } = await (sb as any).from("players").select("first_name, last_name, team, position, is_twp, source_player_id").eq("id", row.player_id).maybeSingle();
  console.log(`\nPlayer: ${p?.first_name} ${p?.last_name} (${p?.team}, ${p?.position}, is_twp=${p?.is_twp})`);

  // Show all his prediction rows for context
  const { data: all } = await (sb as any).from("player_predictions").select("id, season, variant, customer_team_id, model_type, status, p_era, p_war, market_value, pitcher_role").eq("player_id", row.player_id).order("season").order("variant");
  console.log(`\nAll his prediction rows:`);
  for (const r of (all || [])) {
    const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
    console.log(`  ${r.id.slice(0,8)} s=${r.season} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} status=${r.status} | role=${r.pitcher_role} era=${r.p_era?.toFixed(2)} pWar=${r.p_war?.toFixed(3)} MV=${r.market_value?.toFixed(0)}`);
  }
}
