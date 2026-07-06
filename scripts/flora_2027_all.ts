import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (sb as any)
  .from("player_predictions")
  .select("id, customer_team_id, variant, model_type, status, from_era, from_fip, from_k9, p_era, p_war, market_value, p_rv_plus")
  .eq("player_id", "3aec7e58-ef9f-43fc-87c1-4aa871486f15")
  .eq("season", 2027);
console.log(`Flora 2027 rows: ${data?.length}`);
console.log(JSON.stringify(data, null, 2));
