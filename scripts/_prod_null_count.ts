import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== PROD player_predictions 2027 NULL audit ===\n");

// Total 2027 rows by variant
for (const v of ["regular", "precomputed"] as const) {
  const { count: total } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v);
  console.log(`Total ${v} 2027 rows: ${total}`);

  const { count: nullOwar } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v).is("o_war", null);
  const { count: nullMv } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v).is("market_value", null);
  const { count: nullBoth } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v).is("o_war", null).is("market_value", null);
  const { count: nullPwar } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v).is("p_war", null);
  const { count: nullEra } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", v).is("p_era", null);

  console.log(`  NULL o_war:        ${nullOwar} (${((nullOwar! / total!) * 100).toFixed(1)}%)`);
  console.log(`  NULL market_value: ${nullMv} (${((nullMv! / total!) * 100).toFixed(1)}%)`);
  console.log(`  NULL both:         ${nullBoth}`);
  console.log(`  NULL p_war:        ${nullPwar} (pitcher fields, hitter rows expected null)`);
  console.log(`  NULL p_era:        ${nullEra} (pitcher fields)`);
  console.log("");
}

// Cross-check: how many hitters (position not P/SP/RP) have NULL o_war vs MV?
console.log("=== Hitters specifically (position NOT IN P/SP/RP) ===");
for (const v of ["regular", "precomputed"] as const) {
  const { count: total } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).not("players.position", "in", "(P,SP,RP)");
  const { count: nullOwar } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).not("players.position", "in", "(P,SP,RP)").is("o_war", null);
  const { count: nullMv } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).not("players.position", "in", "(P,SP,RP)").is("market_value", null);
  console.log(`  ${v}: total=${total}  NULL o_war=${nullOwar}  NULL market_value=${nullMv}`);
}

console.log("\n=== Pitchers specifically (P/SP/RP) ===");
for (const v of ["regular", "precomputed"] as const) {
  const { count: total } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).in("players.position", ["P","SP","RP"]);
  const { count: nullPwar } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).in("players.position", ["P","SP","RP"]).is("p_war", null);
  const { count: nullMv } = await (sb as any).from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
    .eq("season", 2027).eq("variant", v).in("players.position", ["P","SP","RP"]).is("market_value", null);
  console.log(`  ${v}: total=${total}  NULL p_war=${nullPwar}  NULL market_value=${nullMv}`);
}
