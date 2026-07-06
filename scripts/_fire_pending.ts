import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: pending } = await (sb as any).from("precompute_jobs").select("id, customer_team_id, scope").eq("status", "pending").order("created_at");
console.log(`Found ${pending?.length ?? 0} pending jobs to fire`);
const url = `https://slrxowawbijbjrkozqlj.supabase.co/functions/v1/process-precompute-jobs`;
const auth = `Bearer ${process.env.STAGING_SERVICE_ROLE_KEY}`;
for (const job of (pending || [])) {
  console.log(`Firing ${job.scope} for team ${job.customer_team_id?.slice(0,8)} (${job.id.slice(0,8)})...`);
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth }, body: JSON.stringify({ jobId: job.id }) });
  const text = await res.text().catch(() => "");
  console.log(`  status=${res.status} ${text.slice(0, 200)}`);
}
