import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const cols = ["overall_power_rating", "ba_power_rating", "obp_power_rating", "iso_power_rating", "barrel_score", "contact_score", "chase_score", "ev_score"];
for (const c of cols) {
  const { count } = await (sb as any).from("Hitter Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026).not(c, "is", null);
  console.log(`Hitter Master 2026 ${c.padEnd(22)}: ${count} populated`);
}

// Compare against prod for the same columns
console.log("\n--- spot check: ANY row with overall_power_rating populated, any season? ---");
const { data } = await (sb as any)
  .from("Hitter Master")
  .select("source_player_id, playerFullName, Season, overall_power_rating")
  .not("overall_power_rating", "is", null)
  .order("Season", { ascending: false })
  .limit(3);
console.log(JSON.stringify(data, null, 2));
