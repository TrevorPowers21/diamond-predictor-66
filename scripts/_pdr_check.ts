import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Roblez (real ip=27, RP)
for (const [name, pid] of [["Roblez", "03dd3c82-b85a-43a0-9815-89403d253a2e"], ["Josiah Overbeek", "711045dd-f8ae-4df8-be1c-a1cac94702d5"]] as const) {
  const { data } = await (sb as any).from("player_predictions")
    .select("variant, customer_team_id, pitcher_role, pitcher_depth_role, projected_ip")
    .eq("player_id", pid).eq("season", 2027);
  console.log(`\n${name}:`);
  for (const r of (data || [])) {
    const team = r.customer_team_id?.slice(0,8) ?? "global";
    console.log(`  ${r.variant.padEnd(11)} team=${team.padEnd(10)} pitcher_role=${r.pitcher_role} pitcher_depth_role=${r.pitcher_depth_role} projected_ip=${r.projected_ip}`);
  }
}

// Bulk count
const { count: withPdr } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("season", 2027).eq("variant", "precomputed").not("pitcher_depth_role", "is", null);
console.log(`\nPrecomputed pitcher rows with pitcher_depth_role populated: ${withPdr}`);
