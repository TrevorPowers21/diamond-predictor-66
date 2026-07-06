import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // 3 hitters with both pa + regular_season_pa populated where pa > regular_season_pa
  // (postseason added games)
  const { data } = await (sb as any)
    .from("Hitter Master")
    .select("playerFullName, source_player_id, pa, regular_season_pa")
    .eq("Season", 2026)
    .not("regular_season_pa", "is", null)
    .gt("pa", 200)
    .limit(20);

  // Find ones where pa > regular_season_pa (postseason teams)
  const postseasonPlayers = (data ?? []).filter((r: any) => r.pa > r.regular_season_pa).slice(0, 5);
  console.log("Sample hitters with postseason PA addition:");
  for (const r of postseasonPlayers) {
    console.log(`  ${(r.playerFullName ?? "").padEnd(25)} | regular_season=${String(r.regular_season_pa).padStart(3)} | final=${String(r.pa).padStart(3)} | postseason delta=+${r.pa - r.regular_season_pa}`);
  }

  // For each, get players.pa
  for (const r of postseasonPlayers) {
    const { data: pl } = await (sb as any).from("players").select("first_name, last_name, pa").eq("source_player_id", r.source_player_id).limit(1);
    if (pl && pl[0]) {
      console.log(`    players.${(pl[0].first_name + " " + pl[0].last_name).padEnd(22)} pa=${pl[0].pa} ${pl[0].pa === r.pa ? "✓ matches Master.pa (postseason-inclusive)" : "✗ MISMATCH"}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
