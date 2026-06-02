import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Mirror the dashboard's pitcherPredBySourceId query as closely as possible
const PROJECTION_SEASON = 2027;
const { data, error } = await (sb as any)
  .from("player_predictions")
  .select("player_id, customer_team_id, variant, p_era, whiff_score, bb_score, barrel_score, players!inner(source_player_id, first_name, last_name)")
  .eq("season", PROJECTION_SEASON)
  .in("variant", ["regular", "precomputed"])
  .in("status", ["active", "departed"])
  .not("p_era", "is", null)
  .limit(10);

if (error) { console.error("ERROR:", error); process.exit(1); }

console.log("First 10 pitcher prediction rows:\n");
for (const r of data || []) {
  console.log(`  ${r.players?.first_name} ${r.players?.last_name}: whiff=${r.whiff_score} bb=${r.bb_score} brl=${r.barrel_score} variant=${r.variant}`);
}

// Aggregate counts
const cols = ["whiff_score", "bb_score", "barrel_score"];
console.log("\nCounts (variant=regular, status=active, p_era NOT NULL):");
for (const col of cols) {
  const { count } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("season", PROJECTION_SEASON)
    .eq("variant", "regular")
    .in("status", ["active", "departed"])
    .not("p_era", "is", null)
    .not(col, "is", null);
  console.log(`  ${col} non-null: ${count}`);
}

const { count: total } = await (sb as any)
  .from("player_predictions")
  .select("id", { count: "exact", head: true })
  .eq("season", PROJECTION_SEASON)
  .eq("variant", "regular")
  .in("status", ["active", "departed"])
  .not("p_era", "is", null);
console.log(`  total pitcher returner-regular rows: ${total}`);
