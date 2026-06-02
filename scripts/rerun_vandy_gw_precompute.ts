import { createClient } from "@supabase/supabase-js";

// Verify which Supabase project this script is hitting before doing anything.
const targetUrl = process.env.SUPABASE_URL ?? "(undefined)";
const PROJECT_LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD ✓"
                    : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING"
                    : "UNKNOWN";
console.log(`\nTarget: ${targetUrl}`);
console.log(`This is: ${PROJECT_LABEL}\n`);
if (PROJECT_LABEL !== "PROD ✓") {
  console.error("Refusing to run — not on prod. Source .env.production.local first.");
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const VANDY = "8100792c-5706-40ed-b7c0-c7548df3c946";
const GW    = "6410c543-4f85-407d-ab7d-47402fcd7165";

const teams = [
  { id: VANDY, name: "Vanderbilt" },
  { id: GW,    name: "Gardner-Webb" },
];
const scopes = ["hitters_d1", "pitchers_d1"] as const;

// 1. Enqueue jobs
const jobs: Array<{ id: string; team: string; scope: string }> = [];
for (const t of teams) {
  for (const scope of scopes) {
    const { data, error } = await (sb as any)
      .from("precompute_jobs")
      .insert({ customer_team_id: t.id, scope, trigger_source: "manual_owar_audit_fix" })
      .select("id")
      .single();
    if (error) { console.error(`Failed to enqueue ${t.name}/${scope}:`, error); continue; }
    console.log(`Queued ${t.name} / ${scope}: ${data.id}`);
    jobs.push({ id: data.id, team: t.name, scope });
  }
}

console.log(`\nQueued ${jobs.length} jobs. Firing each via Edge Function...\n`);

// 2. Fire each job
const url = `${process.env.SUPABASE_URL}/functions/v1/process-precompute-jobs`;
const auth = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

for (const job of jobs) {
  console.log(`Firing ${job.team} / ${job.scope} (${job.id})...`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ jobId: job.id }),
  });
  const text = await res.text().catch(() => "");
  console.log(`  status=${res.status} ${text.slice(0, 300)}`);
}

console.log("\nDone firing. Edge Function processes jobs async — give it 30-60s, then re-run the audit script to verify.");
