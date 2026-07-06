import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("precompute_jobs")
  .select("scope, status, error_message, started_at, completed_at, customer_team_id")
  .eq("trigger_source", "manual_bulk_rerun")
  .order("scope");

if (error) {
  console.error("query failed:", error);
  process.exit(1);
}

const byKey = new Map<string, number>();
for (const j of data || []) {
  const k = `${j.scope}|${j.status}`;
  byKey.set(k, (byKey.get(k) || 0) + 1);
}

console.log("Status by scope:");
for (const [k, n] of [...byKey.entries()].sort()) {
  console.log(`  ${k.padEnd(40)} ${n}`);
}

const errs = (data || []).filter((j: any) => j.error_message);
if (errs.length > 0) {
  console.log(`\n${errs.length} jobs with errors:`);
  for (const j of errs.slice(0, 10)) {
    console.log(`  [${j.scope}] team=${j.customer_team_id.slice(0,8)}: ${j.error_message?.slice(0, 200)}`);
  }
}
