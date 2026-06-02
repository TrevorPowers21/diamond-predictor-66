import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const trentId = "f6216028-0e20-4c4c-aaf8-7f72e04389a1";

// 1. Get all 12 of Trent's prediction rows with depth + PA + customer team IDs
const { data: preds } = await (sb as any)
  .from("player_predictions")
  .select("*")
  .eq("player_id", trentId)
  .order("variant")
  .order("season");

console.log("=== ALL 12 prediction rows for Trent Grindlinger ===\n");
for (const r of preds || []) {
  const customer = r.customer_team_id ?? "GLOBAL";
  console.log(`[${r.variant} | ${r.model_type} | s=${r.season}] customer_team_id=${customer}`);
  console.log(`  o_war=${r.o_war?.toFixed(3) ?? "—"}  market_value=${r.market_value ?? "—"}`);
  console.log(`  p_wrc_plus=${r.p_wrc_plus}  projected_pa=${r.projected_pa ?? "—"}  hitter_depth_role=${r.hitter_depth_role ?? "—"}`);
  console.log(`  dev_agg=${r.dev_aggressiveness}  class_transition=${r.class_transition}`);
  console.log(`  from_avg/obp/slg = ${r.from_avg}/${r.from_obp}/${r.from_slg}  from_team=${r.from_team}`);
  console.log();
}

// 2. Find the customer team IDs we just saw + look them up
const customerIds = [...new Set((preds || []).map((r: any) => r.customer_team_id).filter(Boolean))];
console.log(`\n=== Looking up ${customerIds.length} customer team IDs ===`);
if (customerIds.length > 0) {
  const { data: customerTeams } = await (sb as any)
    .from("customer_teams")
    .select("*")
    .in("id", customerIds);
  for (const t of customerTeams || []) {
    console.log(`  ${t.id} → ${JSON.stringify(t)}`);
  }
}
