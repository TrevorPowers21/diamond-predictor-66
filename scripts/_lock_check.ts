import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("player_predictions").select("variant, customer_team_id, locked").eq("player_id", "03dd3c82-b85a-43a0-9815-89403d253a2e").eq("season", 2027);
console.log("Roblez locked status:");
for (const r of (data || [])) console.log(`  ${r.variant.padEnd(11)} team=${r.customer_team_id?.slice(0,8) ?? "global"} locked=${r.locked}`);
