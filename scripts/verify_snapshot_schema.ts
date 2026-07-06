import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data, error } = await (sb as any)
  .from("team_build_players")
  .select("id, player_snapshot")
  .limit(1);
if (error) {
  console.log("ERR — column likely missing:", error.message);
  process.exit(1);
}
console.log("✓ player_snapshot column exists on team_build_players");
console.log("sample value:", JSON.stringify(data?.[0]?.player_snapshot ?? "(null)"));

const { data: fn } = await (sb as any).rpc("refresh_build_snapshots_for_team", { p_team_id: "00000000-0000-0000-0000-000000000000" });
if (fn === null) console.log("✓ RPC refresh_build_snapshots_for_team callable (returned null for fake team)");
