import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const [hm, pm, pp, pl, t] = await Promise.all([
  (sb as any).from("Hitter Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026),
  (sb as any).from("Pitching Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026).gte("IP", 1).not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)"),
  (sb as any).from("player_predictions").select("id", { count: "exact", head: true }).eq("season", 2027).in("variant", ["regular", "precomputed"]),
  (sb as any).from("players").select("id", { count: "exact", head: true }),
  (sb as any).from("Teams Table").select("id", { count: "exact", head: true }),
]);

console.log("Row counts on first ReturningPlayers (Player Dashboard) load:");
console.log("");
console.log(`  Hitter Master (Season=2026):          ${hm.count?.toLocaleString()} rows × 30 cols`);
console.log(`  Pitching Master (Season=2026, IP≥1):  ${pm.count?.toLocaleString()} rows × ALL cols (.select("*"))`);
console.log(`  player_predictions (regular+precomp): ${pp.count?.toLocaleString()} rows`);
console.log(`  players:                              ${pl.count?.toLocaleString()} rows`);
console.log(`  Teams Table:                          ${t.count?.toLocaleString()} rows`);
console.log("");
console.log("Pagination cost (Hitter Master + Pitching Master fetched in pages of 1000):");
const hmPages = Math.ceil((hm.count ?? 0) / 1000);
const pmPages = Math.ceil((pm.count ?? 0) / 1000);
console.log(`  Hitter Master:   ${hmPages} round trips`);
console.log(`  Pitching Master: ${pmPages} round trips`);
