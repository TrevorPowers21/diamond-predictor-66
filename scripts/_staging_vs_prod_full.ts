import { createClient } from "@supabase/supabase-js";
const ST = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PR = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tables = [
  "players", "customer_teams", "player_predictions", "ai_scouting_reports",
  "model_config", "abs_hitter_stats", "abs_pitcher_stats",
  "Pitching Master", "Hitter Master", "Conference Stats", "Teams Table", "Park Factors",
  "pitcher_stuff_plus_ncaa", "pitcher_stuff_plus_inputs", "team_war_snapshots",
  "player_overrides", "nil_valuations", "customer_team_targets", "customer_team_builds",
  "player_prediction_internals", "portal_entries_unmatched"
];

console.log(`${"Table".padEnd(28)} ${"Staging".padStart(10)} ${"Prod".padStart(10)}  Gap`);
console.log("─".repeat(70));
for (const t of tables) {
  const { count: s, error: se } = await (ST as any).from(t).select("*", { count: "exact", head: true });
  const { count: p, error: pe } = await (PR as any).from(t).select("*", { count: "exact", head: true });
  const sStr = se ? "MISSING" : String(s);
  const pStr = pe ? "MISSING" : String(p);
  const gap = (!se && !pe) ? (p - s) : "-";
  const flag = gap === "-" ? "" : gap > 0 ? `← need ${gap}` : gap < 0 ? `! staging has ${-gap} more` : "✓ same";
  console.log(`${t.padEnd(28)} ${sStr.padStart(10)} ${pStr.padStart(10)}  ${flag}`);
}

console.log("\n=== TWP STATE ===");
const { count: stagingTwps } = await (ST as any).from("players").select("*", { count: "exact", head: true }).eq("is_twp", true);
const { count: prodTwps } = await (PR as any).from("players").select("*", { count: "exact", head: true }).eq("is_twp", true);
console.log(`is_twp=true:  staging=${stagingTwps}  prod=${prodTwps}`);

console.log("\n=== CUSTOMER_TEAMS DETAIL ===");
const { data: stTeams } = await (ST as any).from("customer_teams").select("id, name, school_team_id, active");
const { data: prTeams } = await (PR as any).from("customer_teams").select("id, name, school_team_id, active");
console.log("Staging:", JSON.stringify(stTeams, null, 2));
console.log("\nProd:", JSON.stringify(prTeams, null, 2));

console.log("\n=== PLAYER_PREDICTIONS SEASON BREAKDOWN ===");
for (const s of [2026, 2027] as const) {
  const { count: stN } = await (ST as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", s);
  const { count: prN } = await (PR as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", s);
  console.log(`  season ${s}: staging=${stN} prod=${prN}`);
}
