import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Sample 5 hitters with PA > 0 and see if regular_season_pa is set
  const { data: hitters } = await (sb as any)
    .from("Hitter Master")
    .select("PlayerFullName, PA, regular_season_pa")
    .eq("Season", 2026)
    .gt("PA", 50)
    .limit(5);
  console.log(`Hitter Master sample (5 rows with PA > 50):`);
  for (const r of hitters ?? []) {
    console.log(`  ${(r.PlayerFullName ?? "").padEnd(30)} PA=${String(r.PA).padEnd(4)} regular_season_pa=${r.regular_season_pa ?? "NULL"}`);
  }

  // Sample 5 pitchers with IP > 0
  const { data: pitchers } = await (sb as any)
    .from("Pitching Master")
    .select("PlayerFullName, IP, regular_season_ip")
    .eq("Season", 2026)
    .gt("IP", 10)
    .limit(5);
  console.log(`\nPitching Master sample (5 rows with IP > 10):`);
  for (const r of pitchers ?? []) {
    console.log(`  ${(r.PlayerFullName ?? "").padEnd(30)} IP=${String(r.IP).padEnd(6)} regular_season_ip=${r.regular_season_ip ?? "NULL"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
