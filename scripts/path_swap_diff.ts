import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
console.log(`Connecting to: ${url} (${url.includes("trbvxuoliwrfowibatkm") ? "PROD" : url.includes("slrxowawbijbjrkozqlj") ? "STAGING" : "UNKNOWN"})\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

const PROJECTION_SEASON = 2027;

async function fastPathCount() {
  const { count } = await (sb as any)
    .from("player_predictions")
    .select("id, players!inner(id, transfer_portal, portal_status, pa, position, is_twp, division)", { count: "exact", head: true })
    .eq("season", PROJECTION_SEASON)
    .in("model_type", ["returner", "transfer"])
    .eq("variant", "regular")
    .in("status", ["active", "departed"])
    .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
    .not("players.division", "eq", "NJCAA_D1")
    .gte("players.pa", 75);
  return count ?? 0;
}

async function slowPathRowsAndDedup(effectiveTeamId: string | null) {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = (sb as any)
      .from("player_predictions")
      .select("id, player_id, customer_team_id, variant, model_type, status, players!inner(id, transfer_portal, portal_status, pa, position, is_twp, division)")
      .eq("season", PROJECTION_SEASON)
      .in("model_type", ["returner", "transfer"])
      .in("variant", ["regular", "precomputed"])
      .in("status", ["active", "departed"])
      .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
      .not("players.division", "eq", "NJCAA_D1")
      .gte("players.pa", 75);
    if (effectiveTeamId) {
      q = q.or(`customer_team_id.is.null,customer_team_id.eq.${effectiveTeamId}`);
    } else {
      q = q.is("customer_team_id", null);
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  const byPlayer = new Map<string, any[]>();
  for (const r of all) {
    if (!r.player_id) continue;
    const arr = byPlayer.get(r.player_id) || [];
    arr.push(r);
    byPlayer.set(r.player_id, arr);
  }
  let kept = 0, droppedNull = 0, portalKept = 0, portalDropped = 0;
  let portalTotal = 0;
  for (const [pid, rows] of byPlayer.entries()) {
    const isPortal = rows.some((r) => r.players?.transfer_portal === true);
    if (isPortal) portalTotal++;
    let pick = null;
    if (effectiveTeamId) {
      pick = rows.find((r) => r.customer_team_id === effectiveTeamId && r.variant === "precomputed");
    }
    if (!pick) pick = rows.find((r) => r.customer_team_id == null && r.variant === "regular");
    if (!pick) pick = rows.find((r) => r.variant === "precomputed");
    if (pick) {
      kept++;
      if (isPortal) portalKept++;
    } else {
      droppedNull++;
      if (isPortal) portalDropped++;
    }
  }
  return { totalRowsFetched: all.length, distinctPlayers: byPlayer.size, kept, droppedNull, portalTotal, portalKept, portalDropped };
}

console.log("=== FAST path count (no team, variant=regular only) ===");
const fast = await fastPathCount();
console.log(`Hitters with PA>=75 returner+transfer rows: ${fast}\n`);

console.log("=== SLOW path with no team selected ===");
const slowNoTeam = await slowPathRowsAndDedup(null);
console.log(JSON.stringify(slowNoTeam, null, 2));

const { data: teams } = await (sb as any).from("customer_teams").select("id, name").limit(3);
for (const t of teams ?? []) {
  console.log(`\n=== SLOW path with team: ${t.name} (${t.id}) ===`);
  const slowTeam = await slowPathRowsAndDedup(t.id);
  console.log(JSON.stringify(slowTeam, null, 2));
}
