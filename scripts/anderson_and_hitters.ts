import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Find Anderson specifically — narrow to hitter position + any IP
console.log("=== Andersons (any position, any IP) ===");
const { data: andersons } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, pa, ip")
  .ilike("last_name", "%Anderson%")
  .ilike("first_name", "Michael%")
  .not("team", "is", null);
for (const a of (andersons || [])) {
  console.log(`  ${a.first_name} ${a.last_name} | ${a.team} | pos=${a.position} | is_twp=${a.is_twp} | pa=${a.pa} | ip=${a.ip}`);
}

console.log("\n=== Andersons with ip > 0 ===");
const { data: hybridAnderson } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, is_twp, pa, ip")
  .ilike("last_name", "Anderson")
  .gt("ip", 0)
  .not("team", "is", null);
for (const a of (hybridAnderson || [])) {
  console.log(`  ${a.first_name} ${a.last_name} | ${a.team} | pos=${a.position} | is_twp=${a.is_twp} | pa=${a.pa} | ip=${a.ip}`);
}

// Now the broader scan: non-TWP HITTERS (position is a hitter pos) with both p_wrc_plus AND p_rv_plus populated
console.log("\n=== Non-TWP hitters with BOTH p_wrc_plus AND p_rv_plus populated ===");
const { data: rows } = await (sb as any)
  .from("player_predictions")
  .select("player_id, pitcher_role, hitter_depth_role, p_wrc_plus, o_war, p_rv_plus, p_war, market_value, players!inner(first_name, last_name, team, position, is_twp, pa, ip)")
  .eq("season", 2027)
  .eq("variant", "regular")
  .eq("status", "active")
  .not("p_wrc_plus", "is", null)
  .not("p_rv_plus", "is", null)
  .eq("players.is_twp", false)
  .not("players.position", "in", "(SP,RP,CL,P,LHP,RHP)")
  .limit(20);
console.log(`Found ${rows?.length || 0} rows`);
for (const r of (rows || [])) {
  const p = (r as any).players;
  console.log(`\n${p.first_name} ${p.last_name} | ${p.team} | pos=${p.position} | pa=${p.pa} | ip=${p.ip}`);
  console.log(`  pitcher_role=${r.pitcher_role} hitter_depth_role=${r.hitter_depth_role}`);
  console.log(`  p_wrc+=${r.p_wrc_plus} oWAR=${r.o_war?.toFixed?.(2)}  |  p_rv+=${r.p_rv_plus?.toFixed?.(2)} pWAR=${r.p_war?.toFixed?.(2)}  |  market=$${r.market_value?.toFixed?.(0)}`);
}
