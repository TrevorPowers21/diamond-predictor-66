import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== Staging player_predictions score columns NULL audit (2027 regular) ===");
const { count: total } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", "regular");
console.log(`Total regular 2027 rows: ${total}`);

for (const col of ["contact_score", "barrel_score", "ev_score", "chase_score", "whiff_score", "bb_score", "pitcher_barrel_score", "o_war", "p_war", "market_value", "p_avg", "p_wrc_plus"]) {
  const { count } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", "regular").is(col, null);
  const pct = total ? ((count! / total!) * 100).toFixed(1) : "0";
  console.log(`  NULL ${col.padEnd(22)}: ${String(count).padStart(6)} (${pct}%)`);
}

console.log("\n=== Sample row ===");
const { data: sample } = await (sb as any).from("player_predictions").select("contact_score, barrel_score, ev_score, chase_score, whiff_score, bb_score, p_avg, p_wrc_plus, o_war, market_value").eq("season", 2027).eq("variant", "regular").not("p_avg", "is", null).limit(3);
console.log(JSON.stringify(sample, null, 2));
