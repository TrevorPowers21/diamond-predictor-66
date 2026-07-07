import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== model_type breakdown (2026) ===");
const { data: types } = await (PROD as any).from("model_config").select("model_type").eq("season", 2026);
const byType: Record<string, number> = {};
for (const r of types || []) byType[r.model_type] = (byType[r.model_type] || 0) + 1;
console.log(JSON.stringify(byType, null, 2));

console.log("\n=== sample of each model_type ===");
for (const mt of Object.keys(byType)) {
  const { data } = await (PROD as any).from("model_config").select("config_key, config_value").eq("season", 2026).eq("model_type", mt).limit(5);
  console.log(`\nmodel_type = ${mt}:`);
  for (const r of (data || [])) console.log(`  ${r.config_key}: ${r.config_value}`);
}
