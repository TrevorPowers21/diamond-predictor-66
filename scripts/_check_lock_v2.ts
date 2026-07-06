import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // Get full schema first
  const { data: probe, error: probeErr } = await (sb as any).from("Hitter Master").select("*").eq("Season", 2026).limit(1);
  console.log("Hitter columns:", probe?.[0] ? Object.keys(probe[0]) : null);
  console.log("Hitter probe error:", probeErr);
  const { data: probeP } = await (sb as any).from("Pitching Master").select("*").eq("Season", 2026).limit(1);
  console.log("Pitcher columns:", probeP?.[0] ? Object.keys(probeP[0]).slice(0, 40) : null);
  return;
  const { data, error } = await (sb as any).from("Hitter Master").select("playerFullName, PA, regular_season_pa, Season").eq("Season", 2026).limit(5);
  console.log("Hitter sample error:", error);
  console.log("Hitter sample data:", JSON.stringify(data, null, 2));
  const { data: p, error: pe } = await (sb as any).from("Pitching Master").select("playerFullName, IP, regular_season_ip, Season").eq("Season", 2026).limit(5);
  console.log("Pitcher sample error:", pe);
  console.log("Pitcher sample data:", JSON.stringify(p, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
