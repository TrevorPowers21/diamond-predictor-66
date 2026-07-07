import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data, error, count } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027);
console.log("count:", count, "err:", error?.message);
const { data: d2, error: e2 } = await (sb as any).from("player_predictions").select("player_id, class_transition, players!inner(class_year, division)").eq("season", 2027).limit(3);
console.log("with inner err:", e2?.message);
console.log("with inner sample:", JSON.stringify(d2, null, 2));
