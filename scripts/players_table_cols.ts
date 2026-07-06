import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (sb as any).from("players").select("*").limit(1);
console.log("players row keys:");
console.log(Object.keys(data?.[0] || {}).sort().join("\n"));
