import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Roblez specifically
const { data: r } = await (sb as any).from("player_predictions").select("variant, customer_team_id, pitcher_whiff_score, pitcher_bb_score, pitcher_barrel_score, whiff_score, bb_score").eq("player_id", "03dd3c82-b85a-43a0-9815-89403d253a2e").eq("season", 2027);
console.log("=== Roblez scouting scores ===");
for (const row of (r || [])) {
  const team = row.customer_team_id?.slice(0,8) ?? "global";
  console.log(`  ${row.variant.padEnd(11)} team=${team.padEnd(10)} pitcher_whiff=${row.pitcher_whiff_score} pitcher_bb=${row.pitcher_bb_score} pitcher_barrel=${row.pitcher_barrel_score} | legacy whiff=${row.whiff_score} bb=${row.bb_score}`);
}

// Bulk count: how many pitcher rows now have pitcher_bb_score populated?
const { count: withBb } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).not("pitcher_bb_score", "is", null);
const { count: withWhiff } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).not("pitcher_whiff_score", "is", null);
console.log(`\n2027 rows with pitcher_bb_score populated: ${withBb}`);
console.log(`2027 rows with pitcher_whiff_score populated: ${withWhiff}`);
