import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const TEAM_IDS = [
  "51582e71-8d73-42c6-abdc-ca71849c57a9", // Arizona State
  "6deca66a-b4c0-403f-9614-a9d32f1d5994", // Arkansas
  "deeb0be0-83c1-4a84-ba47-4a719f967d48", // BYU
  "66b33ebe-8449-4894-808e-f86f15e3d1f0", // Florida Atlantic
  "6410c543-4f85-407d-ab7d-47402fcd7165", // Gardner-Webb
  "9aef3923-0f11-4813-8036-5766b0db64b6", // Georgia
  "ee947a80-a37e-46d7-bb83-629ee338cfa6", // Kansas
  "8e21628e-5ad2-421d-bce9-6b54175d1375", // Penn State
  "b061b218-397c-40b7-ab97-894eb8f75d05", // Stetson
  "e032ef44-dfd1-420c-a4f0-0917094c440e", // TCU
  "8100792c-5706-40ed-b7c0-c7548df3c946", // Vanderbilt
];

const SCOPES = ["hitters_d1", "pitchers_d1", "juco", "pitchers_juco"];

const rows = TEAM_IDS.flatMap((teamId) =>
  SCOPES.map((scope) => ({
    customer_team_id: teamId,
    scope,
    trigger_source: "manual_bulk_rerun",
  })),
);

console.log(`Enqueuing ${rows.length} jobs (${TEAM_IDS.length} teams × ${SCOPES.length} scopes)`);

const { data: inserted, error: insertErr } = await supabase
  .from("precompute_jobs")
  .insert(rows)
  .select("id, customer_team_id, scope");

if (insertErr) {
  console.error("insert failed:", insertErr);
  process.exit(1);
}

console.log(`Inserted ${inserted?.length ?? 0} job rows`);

const edgeUrl = `${url}/functions/v1/process-precompute-jobs`;
console.log(`Firing ${edgeUrl} for each job...`);

let firedCount = 0;
let fireErrors = 0;
for (const job of inserted || []) {
  try {
    const res = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ jobId: job.id }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`fire ${job.scope}/${job.customer_team_id} failed: ${res.status} ${txt.slice(0, 200)}`);
      fireErrors += 1;
    } else {
      firedCount += 1;
    }
  } catch (err) {
    console.error(`fire ${job.scope}/${job.customer_team_id} threw:`, err);
    fireErrors += 1;
  }
}

console.log(`Fired ${firedCount} jobs, ${fireErrors} errors`);
