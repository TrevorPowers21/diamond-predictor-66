import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
console.log(`Connecting to: ${url}\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

// Replicate the EXACT fast path query as the dashboard does
const all: any[] = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, customer_team_id, variant, model_type, players!inner(id, transfer_portal, portal_status, pa, position, is_twp, division)")
    .eq("season", 2027)
    .in("model_type", ["returner", "transfer"])
    .eq("variant", "regular")
    .in("status", ["active", "departed"])
    .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
    .not("players.division", "eq", "NJCAA_D1")
    .gte("players.pa", 75)
    .order("p_wrc_plus", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); break; }
  all.push(...(data || []));
  if (!data || data.length < PAGE) break;
  from += PAGE;
}

console.log(`Total fast-path rows: ${all.length}`);

const byPlayer = new Map<string, any[]>();
for (const r of all) {
  if (!r.player_id) continue;
  const arr = byPlayer.get(r.player_id) || [];
  arr.push(r);
  byPlayer.set(r.player_id, arr);
}

const dupeBreakdown: Record<string, number> = {};
const portalDupePlayers: any[] = [];
const nonPortalDupePlayers: any[] = [];
for (const [pid, rows] of byPlayer.entries()) {
  if (rows.length === 1) continue;
  const k = `${rows.length}-rows`;
  dupeBreakdown[k] = (dupeBreakdown[k] ?? 0) + 1;
  const isPortal = rows.some((r) => r.players?.transfer_portal === true);
  const modelTypes = rows.map((r) => r.model_type).sort().join("+");
  if (isPortal && portalDupePlayers.length < 3) {
    portalDupePlayers.push({ pid, modelTypes, rowIds: rows.map((r) => r.id) });
  } else if (!isPortal && nonPortalDupePlayers.length < 3) {
    nonPortalDupePlayers.push({ pid, modelTypes, rowIds: rows.map((r) => r.id) });
  }
}

console.log(`Distinct players: ${byPlayer.size}`);
console.log(`Dupe breakdown: ${JSON.stringify(dupeBreakdown)}`);
console.log(`\nPortal player dupe examples:`);
for (const e of portalDupePlayers) console.log(JSON.stringify(e));
console.log(`\nNon-portal dupe examples:`);
for (const e of nonPortalDupePlayers) console.log(JSON.stringify(e));

// Breakdown of dupes by model_type pattern
const patterns: Record<string, number> = {};
for (const rows of byPlayer.values()) {
  if (rows.length === 1) continue;
  const k = rows.map((r) => r.model_type).sort().join("+");
  patterns[k] = (patterns[k] ?? 0) + 1;
}
console.log(`\nDupe model_type patterns:`, patterns);
