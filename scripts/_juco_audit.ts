import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== STAGING players by division ===");
const { data: divs } = await (sb as any).from("players").select("division").limit(20000);
const dDist: Record<string, number> = {};
for (const r of (divs || [])) dDist[r.division ?? "NULL"] = (dDist[r.division ?? "NULL"] || 0) + 1;
for (const [k,v] of Object.entries(dDist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(15)} ${v}`);

console.log("\n=== STAGING Pitching Master by season + JUCO/D1 ===");
for (const s of [2025, 2026, 2027] as const) {
  let juco = 0, d1 = 0, other = 0;
  let from = 0;
  while (true) {
    const { data } = await (sb as any).from("Pitching Master").select("Conference").eq("Season", s).range(from, from+999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) juco++;
      else if (r.Conference) d1++; else other++;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`  ${s}: total=${juco+d1+other}  JUCO=${juco}  D1=${d1}  null=${other}`);
}

console.log("\n=== STAGING Hitter Master by season + JUCO/D1 ===");
for (const s of [2025, 2026, 2027] as const) {
  let juco = 0, d1 = 0, other = 0;
  let from = 0;
  while (true) {
    const { data } = await (sb as any).from("Hitter Master").select("Conference").eq("Season", s).range(from, from+999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) juco++;
      else if (r.Conference) d1++; else other++;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`  ${s}: total=${juco+d1+other}  JUCO=${juco}  D1=${d1}  null=${other}`);
}

console.log("\n=== STAGING player_predictions linked to JUCO players ===");
const { count: jucoPredsViaPlayers } = await (sb as any)
  .from("player_predictions")
  .select("*, players!inner(division)", { count: "exact", head: true })
  .eq("season", 2027)
  .eq("players.division", "NJCAA_D1");
console.log(`  2027 preds where players.division=NJCAA_D1: ${jucoPredsViaPlayers}`);
