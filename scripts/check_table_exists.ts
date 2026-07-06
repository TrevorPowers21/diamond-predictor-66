import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Try a few related table names just in case it's named differently
const candidates = ["ai_scouting_reports", "scouting_reports", "ai_reports", "ScoutingReports"];
for (const name of candidates) {
  const { count, error } = await (STAGING as any).from(name).select("*", { count: "exact", head: true });
  console.log(`STAGING.${name}: count=${count}, err=${error?.message}`);
}
console.log("");
for (const name of candidates) {
  const { count, error } = await (PROD as any).from(name).select("*", { count: "exact", head: true });
  console.log(`PROD.${name}: count=${count}, err=${error?.message}`);
}
