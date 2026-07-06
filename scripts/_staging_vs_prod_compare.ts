import { createClient } from "@supabase/supabase-js";
const ST = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PR = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Test players spanning class years + positions
const tests = [
  { name: "Michael Anderson (PSU, SR-IF)", sid: "1239164928" },
  { name: "Josh Overbeek (NEB, SR-IF)", sid: "1281745664" },
  // Add a few more I'll find by ilike on prod
];

// Find a few more variety players from prod
const { data: more } = await (PR as any).from("players").select("first_name, last_name, source_player_id, position, team, class_year")
  .eq("division", "D1").gte("pa", 100).eq("class_year", "JR").limit(3);
for (const m of (more || [])) {
  tests.push({ name: `${m.first_name} ${m.last_name} (${m.team}, ${m.class_year}-${m.position})`, sid: m.source_player_id });
}
const { data: pitchers } = await (PR as any).from("players").select("first_name, last_name, source_player_id, position, team, class_year")
  .in("position", ["P","SP","RP"]).gte("ip", 30).eq("class_year", "SR").limit(2);
for (const m of (pitchers || [])) {
  tests.push({ name: `${m.first_name} ${m.last_name} (${m.team}, ${m.class_year}-P)`, sid: m.source_player_id });
}

console.log("=== Staging vs Prod regular-variant 2027 predictions ===\n");
for (const t of tests) {
  // Look up player by source_player_id in both
  const { data: sPlayer } = await (ST as any).from("players").select("id, class_year, division").eq("source_player_id", t.sid).maybeSingle();
  const { data: pPlayer } = await (PR as any).from("players").select("id, class_year, division").eq("source_player_id", t.sid).maybeSingle();
  if (!sPlayer || !pPlayer) {
    console.log(`${t.name}: ${!sPlayer ? "MISSING ON STAGING" : "MISSING ON PROD"}`);
    continue;
  }
  // Pull regular variant 2027 prediction
  const { data: sPred } = await (ST as any).from("player_predictions").select("p_avg, p_obp, p_wrc_plus, o_war, p_era, p_fip, p_war, market_value, class_transition")
    .eq("player_id", sPlayer.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
  const { data: pPred } = await (PR as any).from("player_predictions").select("p_avg, p_obp, p_wrc_plus, o_war, p_era, p_fip, p_war, market_value, class_transition")
    .eq("player_id", pPlayer.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();

  console.log(`${t.name}  (sid=${t.sid}, cy_st=${sPlayer.class_year}, cy_pr=${pPlayer.class_year})`);
  if (!sPred || !pPred) {
    console.log(`  Missing pred: staging=${!!sPred} prod=${!!pPred}`);
    continue;
  }
  const fmt = (a: any, b: any) => {
    const av = a == null ? "null" : (typeof a === "number" ? a.toFixed(3) : a);
    const bv = b == null ? "null" : (typeof b === "number" ? b.toFixed(3) : b);
    const same = a == null || b == null ? a === b : Math.abs(Number(a) - Number(b)) < 0.001;
    const diff = (typeof a === "number" && typeof b === "number") ? `Δ=${(a - b).toFixed(3)}` : "";
    return `${av} vs ${bv} ${same ? "✓" : `✗ ${diff}`}`;
  };
  console.log(`  p_avg:       ${fmt(sPred.p_avg, pPred.p_avg)}`);
  console.log(`  p_obp:       ${fmt(sPred.p_obp, pPred.p_obp)}`);
  console.log(`  p_wrc_plus:  ${fmt(sPred.p_wrc_plus, pPred.p_wrc_plus)}`);
  console.log(`  o_war:       ${fmt(sPred.o_war, pPred.o_war)}`);
  console.log(`  p_era:       ${fmt(sPred.p_era, pPred.p_era)}`);
  console.log(`  p_war:       ${fmt(sPred.p_war, pPred.p_war)}`);
  console.log(`  market_val:  ${fmt(sPred.market_value, pPred.market_value)}`);
  console.log(`  ct:          ${fmt(sPred.class_transition, pPred.class_transition)}`);
  console.log("");
}
