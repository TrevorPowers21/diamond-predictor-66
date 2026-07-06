import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL?.replace(/https:\/\//, "").split(".")[0]);

  // 1. Get Hudson's player row by id
  const { data: player, error: pe } = await (sb as any).from("players").select("*").eq("id", "f0a623df-c14a-4cc1-87db-3d4e805f846b").limit(1);
  console.log("\nplayers row:", JSON.stringify(player, null, 2));
  if (pe) console.log("err:", pe);

  if (!player || !player[0]) return;
  const sid = player[0].source_player_id;
  console.log("\nsource_player_id:", sid);

  // 2. Find his Hitter Master row
  const { data: hm } = await (sb as any).from("Hitter Master").select("playerFullName, pa, regular_season_pa, Season, source_player_id").eq("source_player_id", sid);
  console.log("\nHitter Master rows for this sid:", JSON.stringify(hm, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
