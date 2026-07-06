import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
console.log(`Connecting to: ${url}\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

const PROJECTION_SEASON = 2027;

// Pull all variant=regular rows for hitters, count duplicates per player_id
const all: any[] = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, customer_team_id, variant, model_type, status, updated_at, created_at, p_wrc_plus, p_avg, p_obp, p_slg")
    .eq("season", PROJECTION_SEASON)
    .in("model_type", ["returner", "transfer"])
    .eq("variant", "regular")
    .in("status", ["active", "departed"])
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); break; }
  all.push(...(data || []));
  if (!data || data.length < PAGE) break;
  from += PAGE;
}

console.log(`Total variant=regular hitter+transfer rows: ${all.length}`);

const byPlayer = new Map<string, any[]>();
for (const r of all) {
  if (!r.player_id) continue;
  const arr = byPlayer.get(r.player_id) || [];
  arr.push(r);
  byPlayer.set(r.player_id, arr);
}

let dupePlayers = 0;
let extraRows = 0;
const dupeCountHisto: Record<number, number> = {};
const customerTeamIdBucket: Record<string, number> = {};
const modelTypeBucket: Record<string, number> = {};
const examples: any[] = [];

for (const [pid, rows] of byPlayer.entries()) {
  if (rows.length === 1) continue;
  dupePlayers++;
  extraRows += rows.length - 1;
  dupeCountHisto[rows.length] = (dupeCountHisto[rows.length] ?? 0) + 1;
  for (const r of rows) {
    const ct = r.customer_team_id === null ? "null" : "non-null";
    customerTeamIdBucket[ct] = (customerTeamIdBucket[ct] ?? 0) + 1;
    modelTypeBucket[r.model_type] = (modelTypeBucket[r.model_type] ?? 0) + 1;
  }
  if (examples.length < 5) {
    examples.push({
      player_id: pid,
      rows: rows.map((r) => ({
        id: r.id,
        customer_team_id: r.customer_team_id,
        model_type: r.model_type,
        status: r.status,
        p_wrc_plus: r.p_wrc_plus,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
    });
  }
}

console.log(`\nPlayers with duplicate regular rows: ${dupePlayers}`);
console.log(`Extra rows (duplicates beyond the first): ${extraRows}`);
console.log(`\nDistribution of duplicates per player: ${JSON.stringify(dupeCountHisto)}`);
console.log(`customer_team_id buckets across duplicate rows: ${JSON.stringify(customerTeamIdBucket)}`);
console.log(`model_type buckets across duplicate rows: ${JSON.stringify(modelTypeBucket)}`);
console.log(`\nFirst 5 dupe examples:`);
for (const e of examples) console.log(JSON.stringify(e, null, 2));
