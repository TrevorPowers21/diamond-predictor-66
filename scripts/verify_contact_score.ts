import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Explicit select — will throw if column doesn't exist
console.log("Explicit select contact_score on player_predictions:");
const explicit = await (sb as any)
  .from("player_predictions")
  .select("id, contact_score, barrel_score, chase_score, ev_score, whiff_score")
  .eq("variant", "regular")
  .not("p_wrc_plus", "is", null)
  .limit(3);
if (explicit.error) console.log("  ERROR:", explicit.error.message);
else for (const r of explicit.data) console.log("  ", JSON.stringify(r));

console.log("\nHow many predictions have non-null contact_score?");
const { count: nonNull } = await (sb as any)
  .from("player_predictions")
  .select("id", { count: "exact", head: true })
  .not("contact_score", "is", null);
console.log(`  non-null contact_score: ${nonNull}`);

const { count: total } = await (sb as any)
  .from("player_predictions")
  .select("id", { count: "exact", head: true });
console.log(`  total predictions:       ${total}`);

console.log("\nSame check on Hitter Master:");
const { count: hmNonNull } = await (sb as any)
  .from("Hitter Master")
  .select("source_player_id", { count: "exact", head: true })
  .eq("Season", 2026)
  .not("contact_score", "is", null);
const { count: hmTotal } = await (sb as any)
  .from("Hitter Master")
  .select("source_player_id", { count: "exact", head: true })
  .eq("Season", 2026);
console.log(`  Hitter Master non-null contact_score: ${hmNonNull} / ${hmTotal}`);
