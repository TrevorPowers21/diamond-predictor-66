import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const all: any[] = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, status, variant, p_era, p_rv_plus, p_war, market_value, from_era, from_fip, pitcher_role")
    .eq("season", 2026)
    .not("p_era", "is", null)
    .order("id")
    .range(from, from + PAGE - 1);
  if (error) { console.log("err", error.message); break; }
  all.push(...(data || []));
  if (!data || data.length < PAGE) break;
  from += PAGE;
}

console.log(`Total pitcher prediction rows (p_era not null): ${all.length}`);

const byStatus = new Map<string, number>();
for (const r of all) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
console.log("\nBy status:");
for (const [s, c] of byStatus) console.log(`  ${s}: ${c}`);

const stale = all.filter((r) => r.status === "stale");
console.log(`\nStale rows: ${stale.length}`);
const staleHasProj = stale.filter((r) => r.p_rv_plus != null);
const staleHasWar = stale.filter((r) => r.p_war != null);
const staleHasMarket = stale.filter((r) => r.market_value != null);
const staleHasFrom = stale.filter((r) => r.from_era != null);
console.log(`  with p_rv_plus populated:  ${staleHasProj.length} (${Math.round(100*staleHasProj.length/stale.length)}%)`);
console.log(`  with p_war populated:      ${staleHasWar.length} (${Math.round(100*staleHasWar.length/stale.length)}%)`);
console.log(`  with market_value populated: ${staleHasMarket.length} (${Math.round(100*staleHasMarket.length/stale.length)}%)`);
console.log(`  with from_era populated:   ${staleHasFrom.length} (${Math.round(100*staleHasFrom.length/stale.length)}%)`);

const active = all.filter((r) => r.status === "active");
console.log(`\nActive rows: ${active.length}`);
const activeNullWar = active.filter((r) => r.p_war == null);
const activeNullMarket = active.filter((r) => r.market_value == null);
console.log(`  p_war NULL on active: ${activeNullWar.length}`);
console.log(`  market_value NULL on active: ${activeNullMarket.length}`);
