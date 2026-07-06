import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (PROD as any).from("ai_scouting_reports").select("*").limit(2);
console.log("ai_scouting_reports columns:");
console.log(Object.keys(data?.[0] || {}).sort().join("\n"));
console.log("\nsample row (truncated body):");
const sample = { ...data?.[0] };
if (sample.body) sample.body = sample.body.slice(0, 100) + "...";
console.log(JSON.stringify(sample, null, 2));

// Count by side (hitter / pitcher)
for (const side of ["hitter", "pitcher"]) {
  const { count } = await (PROD as any).from("ai_scouting_reports").select("player_id", { count: "exact", head: true }).eq("side", side);
  console.log(`prod side=${side}: ${count}`);
}
