import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
console.log(`Target: ${process.env.SUPABASE_URL}\n`);

const masonId = "88939961-991f-4c9b-aa90-fab51f02cd1d";

// Mirror the EXACT dashboard query for pitcherPredBySourceId
const { data, error } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, status, p_era, players!inner(source_player_id, first_name, last_name)")
  .eq("season", 2027)
  .in("variant", ["regular", "precomputed"])
  .in("status", ["active", "departed"])
  .not("p_era", "is", null)
  .eq("player_id", masonId);

if (error) { console.error(error); process.exit(1); }
console.log(`Rows for Mason matching dashboard query: ${data?.length ?? 0}\n`);

for (const r of data || []) {
  console.log(`  [${r.variant}] team=${r.customer_team_id ?? "GLOBAL"} status=${r.status} p_era=${r.p_era?.toFixed(3)}`);
}

// Also check the global returner regular row WITHOUT the status filter
console.log("\n--- Same query but no status filter ---");
const { data: noStatus } = await (sb as any)
  .from("player_predictions")
  .select("id, customer_team_id, variant, status, p_era, model_type")
  .eq("season", 2027)
  .eq("player_id", masonId)
  .eq("variant", "regular")
  .is("customer_team_id", null);
for (const r of noStatus || []) {
  console.log(`  variant=${r.variant} model=${r.model_type} status=${r.status} p_era=${r.p_era?.toFixed(3)}`);
}
