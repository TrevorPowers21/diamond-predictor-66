import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

// Spot-check Georgia
const GEORGIA = "9aef3923-0f11-4813-8036-5766b0db64b6";

// What does precompute produce for pitchers on Georgia?
const { data: predRows, count } = await supabase
  .from("player_predictions")
  .select("model_type, variant, status, customer_team_id", { count: "exact" })
  .eq("customer_team_id", GEORGIA)
  .eq("variant", "precomputed")
  .eq("season", 2027);

console.log(`Georgia precomputed rows: ${count}`);
const byKey = new Map<string, number>();
for (const r of predRows || []) {
  const k = `${r.model_type}|${r.status}`;
  byKey.set(k, (byKey.get(k) || 0) + 1);
}
for (const [k, n] of byKey) console.log(`  ${k}: ${n}`);

// Look at a few pitcher rows
const { data: pitcherRows } = await supabase
  .from("player_predictions")
  .select("player_id, p_era, p_fip, p_whip, p_k9, p_rv_plus, p_war, market_value, status, updated_at")
  .eq("customer_team_id", GEORGIA)
  .eq("variant", "precomputed")
  .eq("model_type", "transfer")
  .eq("season", 2027)
  .not("p_era", "is", null)
  .limit(5);

console.log("\nSample pitcher rows (precomputed, transfer, Georgia):");
for (const r of pitcherRows || []) {
  console.log(`  ${r.player_id.slice(0,8)} era=${r.p_era} fip=${r.p_fip} whip=${r.p_whip} k9=${r.p_k9} pRV+=${r.p_rv_plus} pWAR=${r.p_war} MV=${r.market_value} status=${r.status}`);
}

// And global returner pitchers (variant=regular)
const { data: returnerSample } = await supabase
  .from("player_predictions")
  .select("player_id, p_era, p_fip, p_rv_plus, updated_at")
  .is("customer_team_id", null)
  .eq("variant", "regular")
  .eq("model_type", "returner")
  .eq("season", 2027)
  .not("p_era", "is", null)
  .order("updated_at", { ascending: false })
  .limit(5);

console.log("\nSample returner pitcher rows (regular, global):");
for (const r of returnerSample || []) {
  console.log(`  ${r.player_id.slice(0,8)} era=${r.p_era} fip=${r.p_fip} pRV+=${r.p_rv_plus} updated=${r.updated_at}`);
}
