import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Hudson Brown — Kentucky hitter
  const { data: hm } = await (sb as any).from("Hitter Master").select("playerFullName, pa, regular_season_pa").ilike("playerFullName", "%Hudson%Brown%").eq("Season", 2026).limit(3);
  console.log("Hitter Master rows for Hudson Brown:");
  for (const r of hm ?? []) console.log(`  ${r.playerFullName.padEnd(20)} pa=${r.pa} regular_season_pa=${r.regular_season_pa}`);

  // players.pa
  if (hm && hm[0]) {
    const { data: players } = await (sb as any).from("players").select("first_name, last_name, pa, ip, source_player_id").ilike("last_name", "Brown").ilike("first_name", "Hudson").limit(5);
    console.log("\nplayers rows:");
    for (const r of players ?? []) console.log(`  ${r.first_name} ${r.last_name.padEnd(15)} pa=${r.pa} ip=${r.ip}  sid=${r.source_player_id}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
