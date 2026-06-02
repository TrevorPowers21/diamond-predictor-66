import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const targetUrl = process.env.SUPABASE_URL ?? "";
const PROJECT_LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD"
                    : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING ✓"
                    : "UNKNOWN";
console.log(`\nTarget: ${targetUrl}`);
console.log(`This is: ${PROJECT_LABEL}\n`);
if (PROJECT_LABEL !== "STAGING ✓") {
  console.error("Refusing to run — this script is staging-only. Use .env.local.");
  process.exit(1);
}

// Staging customer teams (excluding RSTR IQ All-Americans internal)
const TEAMS = [
  { id: "289f4f16-555e-46d3-b899-2462c5cfaa24", name: "Georgia" },
  { id: "81ad0369-e0c7-4427-a8db-39a091863d40", name: "Arkansas" },
  { id: "3f631339-94b7-478e-8690-9c03e3b060f2", name: "Penn State" },
];
const scopes = ["hitters_d1", "pitchers_d1"] as const;

// 1. Wipe precomputed rows for these teams (so stale class_transition / blending
//    can't persist through the re-precompute, which only refreshes tier-PA fields)
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
      .insert({ customer_team_id: t.id, scope, trigger_source: "staging_cleanup" })
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

console.log("\n=== Done. Re-run precompute_staleness_audit.ts to verify. ===");
