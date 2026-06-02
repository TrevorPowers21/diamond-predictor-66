import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const targetUrl = process.env.SUPABASE_URL ?? "";
const PROJECT_LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD ✓"
                    : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING"
                    : "UNKNOWN";
console.log(`\nTarget: ${targetUrl}`);
console.log(`This is: ${PROJECT_LABEL}\n`);
if (PROJECT_LABEL !== "PROD ✓") {
  console.error("Refusing to run — this script is prod-only. Use .env.production.local.");
  process.exit(1);
}

// Prod customer teams (excluding RSTR IQ All-Americans internal team)
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

// 1. Wipe precomputed rows for these teams
console.log("=== Phase 1: Delete existing precomputed rows ===\n");
for (const t of TEAMS) {
  const { count: before } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("customer_team_id", t.id)
    .eq("variant", "precomputed");
  console.log(`${t.name}: ${before ?? 0} precomputed rows`);

  const { error: delErr } = await (sb as any)
    .from("player_predictions")
    .delete()
    .eq("customer_team_id", t.id)
    .eq("variant", "precomputed");
  if (delErr) { console.error(`  DELETE failed:`, delErr); continue; }
  console.log(`  → deleted`);
}

// 2. Enqueue + fire jobs
console.log("\n=== Phase 2: Enqueue + fire precompute jobs ===\n");
const jobs: Array<{ id: string; team: string; scope: string }> = [];
for (const t of TEAMS) {
  for (const scope of scopes) {
    const { data, error } = await (sb as any)
      .from("precompute_jobs")
      .insert({ customer_team_id: t.id, scope, trigger_source: "prod_cleanup_class_transition_fix" })
      .select("id")
      .single();
    if (error) { console.error(`Queue ${t.name}/${scope} failed:`, error); continue; }
    console.log(`Queued ${t.name} / ${scope}: ${data.id}`);
    jobs.push({ id: data.id, team: t.name, scope });
  }
}

const url = `${process.env.SUPABASE_URL}/functions/v1/process-precompute-jobs`;
const auth = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

console.log(`\nFiring ${jobs.length} jobs sequentially...\n`);
for (const job of jobs) {
  console.log(`Firing ${job.team} / ${job.scope}...`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ jobId: job.id }),
  });
  const text = await res.text().catch(() => "");
  console.log(`  status=${res.status}  ${text.slice(0, 250)}`);
}

console.log("\n=== Phase 3: Propagation (populate scoring score columns) ===\n");
console.log("Run these in prod Supabase SQL editor after the jobs above complete:");
console.log(`  SELECT propagate_hitter_scores_to_predictions(2026) AS hitter_rows_updated;`);
console.log(`  SELECT propagate_pitcher_scores_to_predictions(2026) AS pitcher_rows_updated;`);
console.log("\nDone. Then hard refresh the dashboard on prod and verify hitter + pitcher tables are stable.");
