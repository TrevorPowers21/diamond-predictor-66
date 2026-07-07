import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (sb as any).from("player_predictions").select("*").limit(1);
const keys = Object.keys(data?.[0] || {}).sort();
console.log("All player_predictions columns:\n");
console.log(keys.join("\n"));
console.log("\nFrom-prefixed columns:");
console.log(keys.filter((k) => k.startsWith("from_")).join("\n") || "  (none)");
