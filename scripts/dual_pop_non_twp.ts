import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Find 2027 regular rows where BOTH hitter and pitcher fields are populated
// AND the player is NOT a TWP. That's the contamination case we want to test.
const { data: rows, error } = await (sb as any)
  .from("player_predictions")
  .select("player_id, pitcher_role, hitter_depth_role, p_wrc_plus, o_war, p_rv_plus, p_war, market_value, players!inner(first_name, last_name, team, position, is_twp, pa, ip)")
  .eq("season", 2027)
  .eq("variant", "regular")
  .eq("status", "active")
  .not("p_wrc_plus", "is", null)
  .not("p_rv_plus", "is", null)
  .eq("players.is_twp", false)
  .limit(15);
if (error) console.log("err:", error.message);
console.log(`Found ${rows?.length || 0} non-TWP rows with BOTH hitter (p_wrc_plus) and pitcher (p_rv_plus) populated`);
console.log("");
for (const r of (rows || [])) {
  const p = (r as any).players;
  console.log(`${p.first_name} ${p.last_name} (${p.team}, pos=${p.position}, pa=${p.pa}, ip=${p.ip})`);
  console.log(`  pitcher_role=${r.pitcher_role} hitter_depth_role=${r.hitter_depth_role}`);
  console.log(`  p_wrc+=${r.p_wrc_plus} oWAR=${r.o_war?.toFixed?.(2)}  |  p_rv+=${r.p_rv_plus?.toFixed?.(2)} pWAR=${r.p_war?.toFixed?.(2)}  |  market=$${r.market_value?.toFixed?.(0)}`);
  console.log("");
}
