import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
console.log(`Connecting to: ${url}\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

// Exact SLOW path query with no team
const all: any[] = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, customer_team_id, variant, model_type, status, players!inner(id, transfer_portal, portal_status, pa, position, is_twp, division)")
    .eq("season", 2027)
    .in("model_type", ["returner", "transfer"])
    .in("variant", ["regular", "precomputed"])
    .in("status", ["active", "departed"])
    .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
    .not("players.division", "eq", "NJCAA_D1")
    .gte("players.pa", 75)
    .is("customer_team_id", null)
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); break; }
  all.push(...(data || []));
  if (!data || data.length < PAGE) break;
  from += PAGE;
}

console.log(`Total rows: ${all.length}`);

let nullPlayerId = 0;
let hasPlayerId = 0;
const byPlayer = new Map<string, any[]>();
const variantCounts: Record<string, number> = {};
const modelCounts: Record<string, number> = {};
for (const r of all) {
  variantCounts[r.variant] = (variantCounts[r.variant] ?? 0) + 1;
  modelCounts[r.model_type] = (modelCounts[r.model_type] ?? 0) + 1;
  if (!r.player_id) { nullPlayerId++; continue; }
  hasPlayerId++;
  const arr = byPlayer.get(r.player_id) || [];
  arr.push(r);
  byPlayer.set(r.player_id, arr);
}
console.log(`Rows with null player_id: ${nullPlayerId}`);
console.log(`Rows with player_id: ${hasPlayerId}`);
console.log(`Distinct non-null player_ids: ${byPlayer.size}`);
console.log(`Variant distribution: ${JSON.stringify(variantCounts)}`);
console.log(`Model type distribution: ${JSON.stringify(modelCounts)}`);

const multi = Array.from(byPlayer.entries()).filter(([, r]) => r.length > 1);
console.log(`\nPlayers with multiple rows: ${multi.length}`);
if (multi.length > 0) {
  for (let i = 0; i < Math.min(3, multi.length); i++) {
    const [pid, rows] = multi[i];
    console.log(JSON.stringify({ player_id: pid, model_types: rows.map((r) => r.model_type), customer_team_ids: rows.map((r) => r.customer_team_id) }));
  }
}
