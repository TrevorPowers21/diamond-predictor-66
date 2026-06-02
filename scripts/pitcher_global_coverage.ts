import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
console.log(`Target: ${process.env.SUPABASE_URL}\n`);

// How many unique players have ANY pitcher prediction for 2027?
const all = new Set<string>();
let from = 0;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("player_id, customer_team_id, variant")
    .eq("season", 2027)
    .in("variant", ["regular", "precomputed"])
    .in("status", ["active", "departed"])
    .not("p_era", "is", null)
    .range(from, from + 999);
  if (error) { console.error(error); process.exit(1); }
  for (const r of data || []) all.add(r.player_id);
  if (!data || data.length < 1000) break;
  from += 1000;
}
console.log(`Total unique pitchers with ANY 2027 prediction: ${all.size}`);

// How many have a global returner regular row?
const withGlobal = new Set<string>();
let from2 = 0;
while (true) {
  const { data } = await (sb as any)
    .from("player_predictions")
    .select("player_id")
    .eq("season", 2027)
    .eq("variant", "regular")
    .is("customer_team_id", null)
    .in("status", ["active", "departed"])
    .not("p_era", "is", null)
    .range(from2, from2 + 999);
  for (const r of data || []) withGlobal.add(r.player_id);
  if (!data || data.length < 1000) break;
  from2 += 1000;
}
console.log(`Pitchers WITH global returner-regular row: ${withGlobal.size}`);

const missing = [...all].filter((id) => !withGlobal.has(id));
console.log(`Pitchers WITHOUT global row (would be missing from dashboard): ${missing.length}`);

// Sample 5 of the missing ones
if (missing.length > 0) {
  const { data: sample } = await (sb as any)
    .from("players")
    .select("id, first_name, last_name, team, position")
    .in("id", missing.slice(0, 10));
  console.log("\nSample missing pitchers:");
  for (const p of sample || []) console.log(`  ${p.first_name} ${p.last_name} | ${p.team} | ${p.position}`);
}
