/**
 * Re-run precompute on STAGING (Georgia only — staging has 1 customer team).
 * Refuses to run on prod. Mirror of scripts/rerun_all_teams_precompute.ts.
 */
import { createClient } from "@supabase/supabase-js";

const targetUrl = process.env.SUPABASE_URL ?? "(undefined)";
const PROJECT_LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD"
                    : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING ✓"
                    : "UNKNOWN";
console.log(`\nTarget: ${targetUrl}`);
console.log(`This is: ${PROJECT_LABEL}\n`);
if (PROJECT_LABEL !== "STAGING ✓") {
  console.error("Refusing to run — not on staging. Source .env.local first.");
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Discover all active customer teams on staging (likely just Georgia)
const { data: teams } = await (sb as any)
  .from("customer_teams")
  .select("id, name")
  .eq("active", true);
console.log(`Found ${teams?.length ?? 0} active customer teams on staging:`);
for (const t of (teams ?? [])) console.log(`  ${t.id.slice(0,8)} ${t.name}`);
if (!teams || teams.length === 0) { console.error("No teams to precompute. Exiting."); process.exit(1); }

const scopes = ["hitters_d1", "pitchers_d1"] as const;

const jobs: Array<{ id: string; team: string; scope: string }> = [];
for (const t of teams) {
  for (const scope of scopes) {
    const { data, error } = await (sb as any)
      .from("precompute_jobs")
      .insert({ customer_team_id: t.id, scope, trigger_source: "rerun_staging_2026" })
      .select("id")
      .single();
    if (error) { console.error(`  ✗ ${t.name}/${scope}: ${error.message}`); continue; }
    console.log(`  ✓ enqueued ${t.name}/${scope}: ${data.id}`);
    jobs.push({ id: data.id, team: t.name, scope });
  }
}

console.log(`\nEnqueued ${jobs.length} jobs. Firing each via Edge Function...\n`);

const url = `${process.env.SUPABASE_URL}/functions/v1/process-precompute-jobs`;
const auth = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

for (const job of jobs) {
  console.log(`Firing ${job.team} / ${job.scope} (${job.id.slice(0,8)})...`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ jobId: job.id }),
  });
  const text = await res.text().catch(() => "");
  console.log(`  status=${res.status} ${text.slice(0, 300)}`);
}

console.log("\nDone firing. Edge Function processes jobs async — give it a minute per team, then verify in the app.");
