import { createClient } from "@supabase/supabase-js";

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

// All 10 customer teams — UPSERTs existing precomputed rows, no wipe needed.
// Use this instead of prod_wipe_and_reprecompute.ts to update without downtime.
const TEAMS = [
  { id: "ee947a80-a37e-46d7-bb83-629ee338cfa6", name: "Kansas" },
  { id: "9aef3923-0f11-4813-8036-5766b0db64b6", name: "Georgia" },
  { id: "6deca66a-b4c0-403f-9614-a9d32f1d5994", name: "Arkansas" },
  { id: "66b33ebe-8449-4894-808e-f86f15e3d1f0", name: "Florida Atlantic" },
  { id: "e032ef44-dfd1-420c-a4f0-0917094c440e", name: "TCU" },
  { id: "b061b218-397c-40b7-ab97-894eb8f75d05", name: "Stetson" },
  { id: "8e21628e-5ad2-421d-bce9-6b54175d1375", name: "Penn State" },
  { id: "51582e71-8d73-42c6-abdc-ca71849c57a9", name: "Arizona State" },
  { id: "8100792c-5706-40ed-b7c0-c7548df3c946", name: "Vanderbilt" },
  { id: "6410c543-4f85-407d-ab7d-47402fcd7165", name: "Gardner-Webb" },
];
const scopes = ["hitters_d1", "pitchers_d1"] as const;

// Enqueue jobs
const jobs: Array<{ id: string; team: string; scope: string }> = [];
for (const t of TEAMS) {
  for (const scope of scopes) {
    const { data, error } = await (sb as any)
      .from("precompute_jobs")
      .insert({ customer_team_id: t.id, scope, trigger_source: "rerun_correct_csv_data_june2026" })
      .select("id")
      .single();
    if (error) { console.error(`Failed to enqueue ${t.name}/${scope}:`, error); continue; }
    console.log(`Queued ${t.name} / ${scope}: ${data.id}`);
    jobs.push({ id: data.id, team: t.name, scope });
  }
}

console.log(`\nQueued ${jobs.length} jobs. Firing each via Edge Function...\n`);

// Fire each job sequentially
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

console.log("\nDone firing. Edge Function processes jobs async — give it a few minutes per team, then verify in the app.");
