import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (sb as any).from("player_predictions")
  .select("id, season, variant, model_type, customer_team_id, from_avg, from_obp, from_slg, from_avg_plus, from_obp_plus, from_slg_plus, to_avg_plus, to_obp_plus, to_slg_plus")
  .eq("player_id", "29edd467-c5f1-4e64-9f78-d81e4e503c46")
  .order("season").order("variant");
console.log("=== Anderson from_* and to_* columns ===");
for (const r of (data || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`\n${r.id.slice(0,8)} s=${r.season} ${r.variant.padEnd(11)} model=${r.model_type.padEnd(8)} team=${team}`);
  console.log(`  from_avg=${r.from_avg} from_obp=${r.from_obp} from_slg=${r.from_slg}`);
  console.log(`  from_avg_plus=${r.from_avg_plus} from_obp_plus=${r.from_obp_plus} from_slg_plus=${r.from_slg_plus}`);
  console.log(`  to_avg_plus=${r.to_avg_plus} to_obp_plus=${r.to_obp_plus} to_slg_plus=${r.to_slg_plus}`);
}
