import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Across ALL prediction rows (no filter)
const cols = ["contact_score", "barrel_score", "ev_score", "chase_score", "whiff_score"];

console.log("Coverage across ALL player_predictions rows (no filter):\n");
for (const col of cols) {
  const { count: nonNull, error } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .not(col, "is", null);
  if (error) {
    console.log(`  ${col.padEnd(15)} ERROR: ${error.message}`);
    continue;
  }
  console.log(`  ${col.padEnd(15)} ${nonNull?.toLocaleString().padStart(8)}`);
}

const { count: total } = await (sb as any).from("player_predictions").select("id", { count: "exact", head: true });
console.log(`\n  Total rows:    ${total?.toLocaleString().padStart(8)}`);

// Break down by variant
console.log("\nBy variant (barrel_score non-null only):");
for (const v of ["regular", "precomputed", "transfer", "xstats", "current"]) {
  const { count } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("variant", v)
    .not("barrel_score", "is", null);
  if (count != null) console.log(`  ${v.padEnd(15)} ${count.toLocaleString()}`);
}
