import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== all customer_teams ===");
const { data: allCt } = await (sb as any).from("customer_teams").select("*");
console.log(JSON.stringify(allCt, null, 2));
