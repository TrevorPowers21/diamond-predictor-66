import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (PROD as any).from("model_config").select("config_key").eq("season", 2026);
const prefixes: Record<string, number> = {};
for (const r of data || []) {
  const prefix = r.config_key.split("_")[0];
  prefixes[prefix] = (prefixes[prefix] || 0) + 1;
}
console.log("config_key prefix breakdown:");
console.log(prefixes);
