import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
for (const s of [2024, 2025, 2026, 2027, 2028]) {
  const { count } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", s);
  console.log(`season ${s}: ${count}`);
}
const { count: total } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true });
console.log(`TOTAL rows in player_predictions: ${total}`);
