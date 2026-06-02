import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Verify which Supabase project this script is hitting before doing anything.
const targetUrl = process.env.SUPABASE_URL ?? "(undefined)";
const PROJECT_LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD ✓"
                    : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING"
                    : "UNKNOWN";
console.log(`Target: ${targetUrl} (${PROJECT_LABEL})\n`);
if (PROJECT_LABEL === "UNKNOWN") {
  console.error("Refusing to run — env points at unknown Supabase project.");
  process.exit(1);
}

// Pull each customer team
const { data: customerTeams } = await (sb as any)
  .from("customer_teams")
  .select("id, name, display_name, created_at")
  .eq("active", true)
  .order("created_at", { ascending: true });

console.log(`\n=== ${customerTeams?.length ?? 0} active customer teams ===\n`);

console.log("Per-team staleness signals (count of precomputed=transfer rows for season=2027):\n");
console.log("Looking for: hitter_depth_role IS NULL, projected_pa NOT IN tier values, class_transition counts");

console.log("\n| Team | Created | Total Rows | depth_role NULL | proj_pa=131 (raw) | class FS | class SJ | class JS | class GR |");
console.log("|---|---|---|---|---|---|---|---|---|");

const TIER_PA = [25, 85, 145, 215, 245]; // bench, utility, platoon, everyday, cornerstone

for (const t of customerTeams || []) {
  // Pull all precomputed hitter rows for this team
  const { data: rows } = await (sb as any)
    .from("player_predictions")
    .select("hitter_depth_role, projected_pa, class_transition, p_wrc_plus")
    .eq("customer_team_id", t.id)
    .eq("variant", "precomputed")
    .eq("model_type", "transfer")
    .eq("season", 2027);

  const total = rows?.length ?? 0;
  if (total === 0) {
    console.log(`| ${t.display_name ?? t.name} | ${t.created_at?.slice(0,10)} | 0 | — | — | — | — | — | — |`);
    continue;
  }

  const nullDepth = rows.filter((r: any) => r.hitter_depth_role == null).length;
  const rawPa = rows.filter((r: any) => r.projected_pa != null && !TIER_PA.includes(r.projected_pa)).length;
  const fsCount = rows.filter((r: any) => r.class_transition === "FS").length;
  const sjCount = rows.filter((r: any) => r.class_transition === "SJ").length;
  const jsCount = rows.filter((r: any) => r.class_transition === "JS").length;
  const grCount = rows.filter((r: any) => r.class_transition === "GR").length;

  console.log(`| ${t.display_name ?? t.name} | ${t.created_at?.slice(0,10)} | ${total} | ${nullDepth} | ${rawPa} | ${fsCount} | ${sjCount} | ${jsCount} | ${grCount} |`);
}

// Also check: how many active D1 freshmen (currently in players table as class_year=FR)
// have a class_transition that ISN'T FS? Those are the prime suspects for stale class_transition.
console.log("\n=== Mismatch check: Freshmen with class_transition != 'FS' ===\n");
const { count: freshSjCount } = await (sb as any)
  .from("player_predictions")
  .select("id, players!inner(class_year)", { count: "exact", head: true })
  .eq("variant", "precomputed")
  .eq("model_type", "transfer")
  .eq("season", 2027)
  .eq("class_transition", "SJ")
  .eq("players.class_year", "FR");
console.log(`Rows where class_transition='SJ' but player.class_year='FR': ${freshSjCount}`);

const { count: freshFsCount } = await (sb as any)
  .from("player_predictions")
  .select("id, players!inner(class_year)", { count: "exact", head: true })
  .eq("variant", "precomputed")
  .eq("model_type", "transfer")
  .eq("season", 2027)
  .eq("class_transition", "FS")
  .eq("players.class_year", "FR");
console.log(`Rows where class_transition='FS' and player.class_year='FR' (correct): ${freshFsCount}`);
