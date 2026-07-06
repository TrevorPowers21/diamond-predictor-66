import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function slowPath(withOrder: boolean) {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = (sb as any)
      .from("player_predictions")
      .select("id, player_id, customer_team_id, variant, model_type, status, players!inner(id, transfer_portal, portal_status, pa, position, is_twp, division)")
      .eq("season", 2027)
      .in("model_type", ["returner", "transfer"])
      .in("variant", ["regular", "precomputed"])
      .in("status", ["active", "departed"])
      .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
      .not("players.division", "eq", "NJCAA_D1")
      .gte("players.pa", 75)
      .is("customer_team_id", null);
    if (withOrder) q = q.order("id", { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) { console.error(error); break; }
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  const byPlayer = new Map<string, number>();
  for (const r of all) {
    if (!r.player_id) continue;
    byPlayer.set(r.player_id, (byPlayer.get(r.player_id) ?? 0) + 1);
  }
  let dupes = 0;
  for (const c of byPlayer.values()) if (c > 1) dupes++;
  return { rows: all.length, distinctPlayers: byPlayer.size, dupePlayers: dupes };
}

console.log("Without ORDER BY:");
console.log(JSON.stringify(await slowPath(false), null, 2));
console.log("\nWith ORDER BY id:");
console.log(JSON.stringify(await slowPath(true), null, 2));
console.log("\nRun 2 (without ORDER BY) — to show non-determinism:");
console.log(JSON.stringify(await slowPath(false), null, 2));
console.log("\nRun 3 (without ORDER BY):");
console.log(JSON.stringify(await slowPath(false), null, 2));
