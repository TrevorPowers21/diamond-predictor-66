import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// What the pitcher dashboard query needs
const { count: total27 } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027);
console.log(`Total 2027 predictions on staging: ${total27}`);

const { count: withEra } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).not("p_era", "is", null);
console.log(`  with non-null p_era: ${withEra}`);

const { count: activeDep } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).in("status", ["active","departed"]);
console.log(`  status IN (active, departed): ${activeDep}`);

// Variant + customer_team_id distribution
const { data: rows } = await (sb as any).from("player_predictions").select("variant, customer_team_id, p_era").eq("season", 2027).not("p_era", "is", null).limit(5000);
const dist: Record<string, number> = {};
for (const r of (rows || [])) {
  const k = `variant=${r.variant} team=${r.customer_team_id ? "scoped" : "NULL"}`;
  dist[k] = (dist[k] || 0) + 1;
}
console.log(`\nDistribution (sample 5000) of pitcher preds with p_era:`);
for (const [k, v] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(40)} ${v}`);

// Pitcher position players matching predictions
const { count: pitcherPlayers } = await (sb as any).from("players").select("*", { count: "exact", head: true }).in("position", ["P","SP","RP"]);
console.log(`\nStaging players with position P/SP/RP: ${pitcherPlayers}`);

// 2027 pitcher predictions joining to players
const { count: pitcherPreds } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true }).eq("season", 2027).in("players.position", ["P","SP","RP"]);
console.log(`2027 pitcher predictions (join players.position IN P/SP/RP): ${pitcherPreds}`);

// Same with FULL dashboard filter
const { count: dash } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true }).eq("season", 2027).in("status", ["active","departed"]).not("p_era", "is", null).in("players.position", ["P","SP","RP"]);
console.log(`Full dashboard filter (season=2027, status active/dep, p_era NOT NULL, players.position pitcher): ${dash}`);
