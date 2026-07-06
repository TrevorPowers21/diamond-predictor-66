import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function loadAll<T>(builder: () => any): Promise<T[]> {
  const out: any[] = []; let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const TEAMS = [
  { id: "9aef3923-0f11-4813-8036-5766b0db64b6", name: "Georgia" },
  { id: "8100792c-5706-40ed-b7c0-c7548df3c946", name: "Vanderbilt" },
];

for (const t of TEAMS) {
  const rows = await loadAll<any>(() =>
    (sb as any)
      .from("player_predictions")
      .select("player_id, p_avg, p_era, projected_ip, pitcher_role, updated_at, players!inner(division, is_twp, position, ip, pa)")
      .eq("customer_team_id", t.id)
      .eq("variant", "precomputed")
      .eq("model_type", "transfer")
      .eq("season", 2027)
      .eq("players.division", "NJCAA_D1")
  );
  let h = 0, p = 0, both = 0;
  let twpHitterOnly = 0, twpPitcherOnly = 0, twpBoth = 0;
  for (const r of rows) {
    const isH = r.p_avg != null;
    const isP = r.p_era != null;
    if (isH) h++;
    if (isP) p++;
    if (isH && isP) both++;
    if (r.players?.is_twp) {
      if (isH && isP) twpBoth++;
      else if (isH) twpHitterOnly++;
      else if (isP) twpPitcherOnly++;
    }
  }
  console.log(`${t.name}: total=${rows.length}  hitter=${h}  pitcher=${p}  both=${both}`);
  console.log(`  TWPs in this set: ${twpHitterOnly + twpPitcherOnly + twpBoth} (hitterOnly=${twpHitterOnly}, pitcherOnly=${twpPitcherOnly}, both=${twpBoth})`);

  // Check updated_at distribution to see if write times differ
  const todayCount = rows.filter((r: any) => (r.updated_at || "").startsWith("2026-06-03")).length;
  console.log(`  Rows updated today (2026-06-03): ${todayCount}`);
}
