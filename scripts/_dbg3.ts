import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const tables = ["players","customer_teams","player_predictions","ai_scouting_reports","model_config","abs_hitter_stats"];
for (const t of tables) {
  const { count, error } = await (sb as any).from(t).select("*", { count: "exact", head: true });
  console.log(`${t.padEnd(28)} ${error ? "ERR " + error.message : count}`);
}
