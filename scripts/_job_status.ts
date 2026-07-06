import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("precompute_jobs").select("id, customer_team_id, scope, status, error_message, started_at, completed_at, created_at").order("created_at", { ascending: false }).limit(10);
console.log("Recent precompute jobs:");
for (const j of (data || [])) {
  const team = j.customer_team_id?.slice(0,8) ?? "?";
  console.log(`  ${j.id.slice(0,8)} team=${team} scope=${j.scope.padEnd(12)} status=${j.status.padEnd(10)} started=${j.started_at} completed=${j.completed_at} err=${j.error_message ?? ""}`);
}
