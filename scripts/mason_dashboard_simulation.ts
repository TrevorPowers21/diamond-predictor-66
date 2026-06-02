import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
console.log(`Target: ${process.env.SUPABASE_URL}\n`);

// Mirror exact dashboard query — no player_id filter, paginate
const PROJECTION_SEASON = 2027;
const effectiveTeamId: string | null = null; // cross-team view

const map = new Map<string, any>();
let from = 0;
const PAGE = 1000;
let totalScanned = 0;

while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("player_id, customer_team_id, variant, p_era, p_war, market_value, players!inner(source_player_id, first_name, last_name)")
    .eq("season", PROJECTION_SEASON)
    .in("variant", ["regular", "precomputed"])
    .in("status", ["active", "departed"])
    .not("p_era", "is", null)
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); process.exit(1); }
  for (const r of (data || []) as any[]) {
    const srcId = r.players?.source_player_id;
    if (!srcId) continue;
    const existing = map.get(srcId);
    const wantsTeamRow = effectiveTeamId && r.customer_team_id === effectiveTeamId && r.variant === "precomputed";
    const wantsGlobalRow = !effectiveTeamId && r.variant === "regular" && r.customer_team_id == null;
    const fallback = r.variant === "regular" && r.customer_team_id == null;
    const shouldSet = wantsTeamRow || wantsGlobalRow || (!existing && fallback);
    if (!shouldSet && existing) continue;
    map.set(srcId, {
      p_era: r.p_era,
      p_war: r.p_war,
      market_value: r.market_value,
      variant: r.variant,
      customer_team_id: r.customer_team_id,
      name: `${r.players.first_name} ${r.players.last_name}`,
    });
    totalScanned++;
  }
  if (!data || data.length < PAGE) break;
  from += PAGE;
  console.log(`...processed ${totalScanned} rows, on page ${from/PAGE}`);
}

console.log(`\nTotal map.set calls: ${totalScanned}, map size: ${map.size}\n`);

// Find Mason
const MASON_SRC_ID = "20120137"; // need to discover
// Actually source_player_id for Mason - get it
const { data: m } = await (sb as any)
  .from("players")
  .select("source_player_id")
  .eq("id", "88939961-991f-4c9b-aa90-fab51f02cd1d")
  .single();
console.log(`Mason source_player_id = ${m?.source_player_id}`);

const masonEntry = map.get(String(m?.source_player_id));
console.log(`\nMap entry for Mason:`, masonEntry);
