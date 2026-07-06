import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const ids = process.argv.slice(2);
for (const id of ids) {
  console.log(`\n=== ${id} ===`);
  const { data } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, season, variant, model_type, status, customer_team_id, from_era, from_fip, from_k9, p_era, p_war, market_value, p_rv_plus, p_avg, p_obp, p_slg, p_wrc_plus, o_war")
    .eq("id", id)
    .maybeSingle();
  console.log(JSON.stringify(data, null, 2));
}
