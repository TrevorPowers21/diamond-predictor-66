import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 2027 pitcher prediction rows total
const { count: total } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .in("players.position", ["P","SP","RP"]).eq("season", 2027);

// with non-null p_era
const { count: withEra } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .in("players.position", ["P","SP","RP"]).eq("season", 2027).not("p_era", "is", null);

// with status active/departed
const { count: activeDep } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .in("players.position", ["P","SP","RP"]).eq("season", 2027).in("status", ["active","departed"]);

// matching the full dashboard filter
const { count: dashboardCount } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .in("players.position", ["P","SP","RP"]).eq("season", 2027)
  .in("status", ["active","departed"]).not("p_era", "is", null);

console.log(`2027 pitcher pred rows total:            ${total}`);
console.log(`  with non-null p_era:                   ${withEra}`);
console.log(`  with status IN (active, departed):     ${activeDep}`);
console.log(`  matching FULL dashboard filter:        ${dashboardCount}`);

// status distribution for pitchers
const { data: statusSample } = await (sb as any)
  .from("player_predictions").select("status, p_era, players!inner(position)")
  .in("players.position", ["P","SP","RP"]).eq("season", 2027).limit(5000);
const statusDist: Record<string, { total: number; withEra: number }> = {};
for (const r of (statusSample || [])) {
  const s = r.status ?? "NULL";
  if (!statusDist[s]) statusDist[s] = { total: 0, withEra: 0 };
  statusDist[s].total++;
  if (r.p_era != null) statusDist[s].withEra++;
}
console.log("\nstatus distribution (sample 5000):");
for (const [s, v] of Object.entries(statusDist).sort((a,b)=>b[1].total - a[1].total)) {
  console.log(`  ${s.padEnd(20)} total=${v.total}  withEra=${v.withEra}  nullEra=${v.total - v.withEra}`);
}
