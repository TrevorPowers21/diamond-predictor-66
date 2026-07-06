import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const env = process.env.SUPABASE_URL?.includes("trbvxuoliwrfowibatkm") ? "STAGING" : "PROD";
console.log(`=== Querying ${env} ===\n`);

for (const season of [2026, 2027]) {
  const buckets: Record<string, number> = {};
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await (sb as any)
      .from("player_predictions")
      .select("status, variant, model_type")
      .eq("season", season)
      .eq("variant", "regular")
      .eq("model_type", "returner")
      .range(from, from + PAGE - 1);
    if (error) { console.log("err", error.message); break; }
    for (const r of (data || [])) {
      const key = r.status;
      buckets[key] = (buckets[key] || 0) + 1;
    }
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`season=${season}, variant=regular, model_type=returner:`);
  for (const [s, c] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(10)}: ${c}`);
  console.log("");
}

// Now show how many players have BOTH a 2026 returner-regular AND a 2027 returner-regular
const { data: dual } = await (sb as any)
  .from("player_predictions")
  .select("player_id, season, status, updated_at")
  .eq("variant", "regular")
  .eq("model_type", "returner")
  .in("season", [2026, 2027]);
const byPlayer = new Map<string, { has26: boolean; has27: boolean; s26?: string; s27?: string }>();
for (const r of (dual || [])) {
  const entry = byPlayer.get(r.player_id) || { has26: false, has27: false };
  if (r.season === 2026) { entry.has26 = true; entry.s26 = r.status; }
  if (r.season === 2027) { entry.has27 = true; entry.s27 = r.status; }
  byPlayer.set(r.player_id, entry);
}
let bothCount = 0;
const tieCount: Record<string, number> = {};
for (const [_, e] of byPlayer) {
  if (e.has26 && e.has27) {
    bothCount++;
    const tieKey = `${e.s26}|${e.s27}`;
    tieCount[tieKey] = (tieCount[tieKey] || 0) + 1;
  }
}
console.log(`Players with BOTH 2026 and 2027 returner-regular rows: ${bothCount}`);
console.log("Status pairs (2026|2027):");
for (const [k, c] of Object.entries(tieCount).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(25)}: ${c}`);
