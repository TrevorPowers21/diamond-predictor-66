import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Find source_player_ids in BOTH Hitter Master AND Pitching Master for 2026
const { data: hm } = await (sb as any).from("Hitter Master").select("source_player_id, chase_score").eq("Season", 2026).not("chase_score", "is", null);
const { data: pm } = await (sb as any).from("Pitching Master").select("source_player_id, chase_score, IP").eq("Season", 2026).not("chase_score", "is", null);
console.log(`Hitter Master rows w/ chase_score: ${hm?.length ?? 0}`);
console.log(`Pitching Master rows w/ chase_score: ${pm?.length ?? 0}`);

const hmMap = new Map((hm ?? []).map((r: any) => [r.source_player_id, r.chase_score]));
const collisions = (pm ?? []).filter((r: any) => hmMap.has(r.source_player_id));
console.log(`Collisions (player in BOTH tables w/ chase_score): ${collisions.length}`);

// Show distribution by IP
const byIp: Record<string, number> = {};
for (const c of collisions) {
  const ip = c.IP ?? 0;
  const bucket = ip < 5 ? "<5 IP" : ip < 20 ? "5-19 IP" : ip < 50 ? "20-49 IP" : "50+ IP";
  byIp[bucket] = (byIp[bucket] ?? 0) + 1;
}
console.log("Collision distribution by pitcher IP:", byIp);
console.log("\nFirst 5 collisions with diff:");
for (const c of collisions.slice(0, 5)) {
  console.log(`  sid=${c.source_player_id}  HM chase=${hmMap.get(c.source_player_id)}  PM chase=${c.chase_score}  IP=${c.IP}`);
}
