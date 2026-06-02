import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Distribution of variants and seasons
const { data } = await (sb as any).from("player_predictions").select("variant, season, customer_team_id").range(0, 30000);
const buckets: Record<string, number> = {};
for (const r of data ?? []) {
  const k = `variant=${r.variant} season=${r.season} customer=${r.customer_team_id ? "team" : "null"}`;
  buckets[k] = (buckets[k] ?? 0) + 1;
}
console.log("Sampled " + (data?.length ?? 0) + " rows. Distribution:");
for (const [k, n] of Object.entries(buckets).sort((a,b) => b[1]-a[1]).slice(0, 30)) {
  console.log(`  ${n}  ${k}`);
}
