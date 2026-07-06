import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, class_year, position, team").eq("id", "29edd467-c5f1-4e64-9f78-d81e4e503c46").maybeSingle();
console.log("Anderson players row:", JSON.stringify(p, null, 2));

const { data: preds } = await (sb as any).from("player_predictions")
  .select("id, season, variant, model_type, customer_team_id, class_transition, class_transition_overridden, dev_aggressiveness, updated_at")
  .eq("player_id", "29edd467-c5f1-4e64-9f78-d81e4e503c46")
  .order("season").order("variant");
console.log("\n=== All prediction rows with class_transition ===");
for (const r of (preds || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`  ${r.id.slice(0,8)} s=${r.season} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team.padEnd(10)} ct=${(r.class_transition ?? "NULL").padEnd(4)} overridden=${r.class_transition_overridden} dev_agg=${r.dev_aggressiveness}`);
}
