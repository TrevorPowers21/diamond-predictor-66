import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Confirm columns exist
const { data: col, error } = await (sb as any).from("player_predictions").select("twp_hitter_market_value, twp_pitcher_market_value").limit(1);
if (error) {
  console.log("Column check ERROR:", error.message);
} else {
  console.log("Columns exist ✓");
}

// Find Josiah on staging
const { data: josiah } = await (sb as any).from("players").select("id, first_name, last_name, team, pa, ip, is_twp").ilike("first_name", "Josiah").ilike("last_name", "%Overbeek%").maybeSingle();
console.log("\nJosiah staging row:", JSON.stringify(josiah));

if (josiah?.id) {
  const { data: preds } = await (sb as any).from("player_predictions")
    .select("variant, customer_team_id, p_war, o_war, market_value, twp_hitter_market_value, twp_pitcher_market_value")
    .eq("player_id", josiah.id).eq("season", 2027);
  console.log("\nJosiah prediction rows:");
  for (const r of (preds || [])) {
    const team = r.customer_team_id?.slice(0,8) ?? "global";
    console.log(`  ${r.variant.padEnd(11)} team=${team.padEnd(10)} oWar=${r.o_war?.toFixed(3) ?? "null"} pWar=${r.p_war?.toFixed(3) ?? "null"} MV=${r.market_value ?? "null"} twp_h=${r.twp_hitter_market_value ?? "null"} twp_p=${r.twp_pitcher_market_value ?? "null"}`);
  }
}
