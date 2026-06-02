import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1. Find Grindlinger player(s)
const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, source_player_id, position, pa, is_twp, transfer_portal, portal_status, division, conference")
  .ilike("last_name", "Grindlinger")
  .limit(10);

console.log("=== Players matching Grindlinger ===\n");
for (const p of players || []) {
  console.log(`  ${p.first_name} ${p.last_name} | id=${p.id}`);
  console.log(`    team=${p.team} | pos=${p.position} | pa=${p.pa} | twp=${p.is_twp} | portal=${p.portal_status}`);
  console.log(`    source_player_id=${p.source_player_id} | div=${p.division} | conf=${p.conference}`);
  console.log();
}

if (!players || players.length === 0) { console.log("No Grindlinger found"); process.exit(0); }

// Find Vanderbilt + Gardner Webb team UUIDs
const { data: teams } = await (sb as any)
  .from("Teams Table")
  .select("id, name, abbreviation, fullName, conference")
  .or("name.ilike.%Vanderbilt%,name.ilike.%Gardner%,fullName.ilike.%Vanderbilt%,fullName.ilike.%Gardner%")
  .limit(20);

console.log("=== Vanderbilt + Gardner Webb teams ===");
const teamMap = new Map<string, any>();
for (const t of teams || []) {
  console.log(`  ${t.fullName ?? t.name} | id=${t.id} | abbrev=${t.abbreviation} | conf=${t.conference}`);
  teamMap.set(t.id, t);
}
console.log();

// 2. Pull all prediction rows for Grindlinger
for (const p of players) {
  console.log(`\n=== Prediction rows for ${p.first_name} ${p.last_name} (${p.id}) ===\n`);
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("id, customer_team_id, variant, model_type, status, season, p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, projected_pa, hitter_depth_role, dev_aggressiveness, class_transition, from_avg, from_obp, from_slg, from_team, from_conference")
    .eq("player_id", p.id)
    .order("variant", { ascending: true });

  if (!preds || preds.length === 0) { console.log("  (no predictions)"); continue; }

  for (const r of preds) {
    const teamLabel = r.customer_team_id ? (teamMap.get(r.customer_team_id)?.fullName ?? r.customer_team_id) : "GLOBAL";
    console.log(`  [${r.variant}] season=${r.season} model=${r.model_type} status=${r.status} customer=${teamLabel}`);
    console.log(`    p_avg/obp/slg = ${r.p_avg}/${r.p_obp}/${r.p_slg}  p_wrc+=${r.p_wrc_plus}`);
    console.log(`    o_war=${r.o_war}  market_value=${r.market_value}  projected_pa=${r.projected_pa}`);
    console.log(`    depth=${r.hitter_depth_role}  dev_agg=${r.dev_aggressiveness}  class_transition=${r.class_transition}`);
    console.log(`    from_avg/obp/slg = ${r.from_avg}/${r.from_obp}/${r.from_slg}  from_team=${r.from_team}  from_conf=${r.from_conference}`);
    console.log();
  }
}
