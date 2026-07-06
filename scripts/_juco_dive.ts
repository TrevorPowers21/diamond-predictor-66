import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Full staging players division distribution
const all: any[] = []; let from = 0;
while (true) {
  const { data } = await (sb as any).from("players").select("division, position").range(from, from+999);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const dDist: Record<string, number> = {};
for (const r of all) dDist[r.division ?? "NULL"] = (dDist[r.division ?? "NULL"] || 0) + 1;
console.log(`=== STAGING players (${all.length} total) by division ===`);
for (const [k,v] of Object.entries(dDist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(15)} ${v}`);

// Sample JUCO Hitter Master row + try to find their player row
console.log("\n=== Sample JUCO Hitter Master 2026 row (do they have a players row?) ===");
const { data: jucoHm } = await (sb as any).from("Hitter Master").select("source_player_id, playerFullName, Team, Conference, AVG, ab").eq("Season", 2026).ilike("Conference", "%njcaa%").limit(5);
for (const r of (jucoHm || [])) {
  const { data: pl } = await (sb as any).from("players").select("id, division, team").eq("source_player_id", r.source_player_id).maybeSingle();
  console.log(`  ${r.playerFullName} (${r.Team}, ${r.Conference}) AVG=${r.AVG} AB=${r.ab}`);
  console.log(`    → players row: ${pl ? `id=${pl.id.slice(0,8)} div=${pl.division} team=${pl.team}` : "NOT FOUND"}`);
}

// Check if dashboard JUCO might be coming from prediction rows directly
console.log("\n=== STAGING player_predictions hitter rows where players.division=D1 but conference=NJCAA ===");
const { count: jucoLeakD1 } = await (sb as any)
  .from("player_predictions")
  .select("*, players!inner(division, conference)", { count: "exact", head: true })
  .eq("season", 2027)
  .eq("players.division", "D1")
  .ilike("players.conference", "%njcaa%");
console.log(`  count: ${jucoLeakD1}`);
