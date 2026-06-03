import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

// Full count by buckets — paginated to handle all JUCO predictions
const buckets: Record<string, number> = {};
let from = 0;
let total = 0;
while (true) {
  const { data } = await (sb as any)
    .from("player_predictions")
    .select("model_type, variant, season, customer_team_id, players!inner(division)")
    .eq("players.division", "NJCAA_D1")
    .order("id", { ascending: true })
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  total += data.length;
  for (const r of data) {
    const k = `model_type=${r.model_type} variant=${r.variant} season=${r.season} customer=${r.customer_team_id ? "team" : "null"}`;
    buckets[k] = (buckets[k] ?? 0) + 1;
  }
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Total JUCO prediction rows: ${total}`);
for (const [k, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(6)}  ${k}`);
}

// Updated_at: when was the most recent JUCO precompute?
const { data: latest } = await (sb as any)
  .from("player_predictions")
  .select("updated_at, season, model_type, players!inner(division)")
  .eq("players.division", "NJCAA_D1")
  .order("updated_at", { ascending: false })
  .limit(5);
console.log(`\nMost recent JUCO predictions updated_at:`);
for (const r of latest ?? []) console.log(`  ${r.updated_at}  season=${r.season} model_type=${r.model_type}`);

// Oldest JUCO predictions
const { data: oldest } = await (sb as any)
  .from("player_predictions")
  .select("updated_at, season, model_type, players!inner(division)")
  .eq("players.division", "NJCAA_D1")
  .order("updated_at", { ascending: true })
  .limit(5);
console.log(`\nOldest JUCO predictions updated_at:`);
for (const r of oldest ?? []) console.log(`  ${r.updated_at}  season=${r.season} model_type=${r.model_type}`);
