import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tables = [
  "players","customer_teams","player_predictions","ai_scouting_reports","model_config",
  "pitching_master","hitter_master","conference_stats","teams_table","park_factors",
  "player_overrides","team_war_snapshots","pitcher_stuff_plus_ncaa","pitcher_stuff_plus_inputs",
  "abs_hitter_stats","abs_pitcher_stats","customer_team_targets","customer_team_builds",
];
console.log("=== PROD table row counts ===");
for (const t of tables) {
  const { count, error } = await (sb as any).from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t.padEnd(30)} ${error ? "ERR " + error.message : count}`);
}

console.log("\n=== PROD pitching_master by season ===");
for (const s of [2023, 2024, 2025, 2026]) {
  const { count } = await (sb as any).from("pitching_master").select("*", { count: "exact", head: true }).eq("season", s);
  console.log(`  season ${s}: ${count}`);
}

console.log("\n=== PROD hitter_master by season ===");
for (const s of [2023, 2024, 2025, 2026]) {
  const { count } = await (sb as any).from("hitter_master").select("*", { count: "exact", head: true }).eq("season", s);
  console.log(`  season ${s}: ${count}`);
}

console.log("\n=== PROD players by division ===");
const divs = ["D1","NJCAA_D1","NJCAA D1","JUCO"];
for (const d of divs) {
  const { count } = await (sb as any).from("players").select("*", { count: "exact", head: true }).eq("division", d);
  console.log(`  division=${d.padEnd(12)} ${count}`);
}

console.log("\n=== PROD player_predictions by season ===");
for (const s of [2025, 2026, 2027, 2028]) {
  const { count } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", s);
  console.log(`  season ${s}: ${count}`);
}
