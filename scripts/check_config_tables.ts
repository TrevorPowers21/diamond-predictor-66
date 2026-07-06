import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== model_config columns + season breakdown ===");
const { data: mcSample } = await (PROD as any).from("model_config").select("*").limit(2);
console.log("sample row:", JSON.stringify(mcSample?.[0], null, 2));
// Try to count by season if column exists
if (mcSample?.[0] && "season" in mcSample[0]) {
  for (const season of [2024, 2025, 2026, 2027]) {
    const { count } = await (PROD as any).from("model_config").select("config_key", { count: "exact", head: true }).eq("season", season);
    console.log(`  season ${season}: ${count} rows`);
  }
}

console.log("\n=== pitcher_stuff_plus_ncaa columns + breakdown ===");
const { data: pSample } = await (PROD as any).from("pitcher_stuff_plus_ncaa").select("*").limit(2);
console.log("sample row:", JSON.stringify(pSample?.[0], null, 2));
if (pSample?.[0] && "season" in pSample[0]) {
  for (const season of [2024, 2025, 2026, 2027]) {
    const { count } = await (PROD as any).from("pitcher_stuff_plus_ncaa").select("*", { count: "exact", head: true }).eq("season", season);
    console.log(`  season ${season}: ${count} rows`);
  }
}
