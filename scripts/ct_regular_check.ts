import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const cys = ["FR", "SO", "JR", "SR"];
console.log("=== STAGING REGULAR variant (non-redshirts) ===");
for (const cy of cys) {
  const { data } = await (STAGING as any)
    .from("player_predictions")
    .select("class_transition, players!inner(class_year)")
    .eq("season", 2027)
    .eq("variant", "regular")
    .eq("players.class_year", cy)
    .limit(5000);
  const dist: Record<string, number> = {};
  for (const r of (data || [])) {
    const ct = r.class_transition ?? "NULL";
    dist[ct] = (dist[ct] || 0) + 1;
  }
  const s = Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ");
  console.log(`  class_year=${cy.padEnd(4)} → ${s}`);
}
