import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Check season_stats
const { count: ssCount } = await (sb as any).from("season_stats").select("*", { count: "exact", head: true });
console.log(`season_stats total rows on prod: ${ssCount}`);
const { data: ssSample } = await (sb as any).from("season_stats").select("*").limit(3);
console.log("season_stats sample:", JSON.stringify(ssSample, null, 2));

// Hitter Master prod by season
console.log("\n=== Hitter Master prod by season ===");
for (const s of [2023, 2024, 2025, 2026]) {
  const { count } = await (sb as any).from("Hitter Master").select("*", { count: "exact", head: true }).eq("Season", s);
  let juco = 0, d1 = 0;
  const { data } = await (sb as any).from("Hitter Master").select("Conference").eq("Season", s).limit(1000);
  for (const r of (data || [])) {
    if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) juco++;
    else if (r.Conference) d1++;
  }
  console.log(`  Season ${s}: total=${count}  (first 1000: JUCO=${juco} D1=${d1})`);
}

// Pitching Master prod by season  
console.log("\n=== Pitching Master prod by season ===");
for (const s of [2023, 2024, 2025, 2026]) {
  const { count } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", s);
  let juco = 0, d1 = 0;
  const { data } = await (sb as any).from("Pitching Master").select("Conference").eq("Season", s).limit(1000);
  for (const r of (data || [])) {
    if (typeof r.Conference === "string" && r.Conference.toLowerCase().includes("njcaa")) juco++;
    else if (r.Conference) d1++;
  }
  console.log(`  Season ${s}: total=${count}  (first 1000: JUCO=${juco} D1=${d1})`);
}

// Pick a known prod hitter with rows in 2025 — e.g., Michael Anderson (Penn State, SR) from yesterday's audit
const { data: testHitter } = await (sb as any).from("players").select("id, first_name, last_name, source_player_id, position, team").ilike("last_name", "Anderson").eq("first_name", "Michael").maybeSingle();
console.log("\n=== Test hitter Michael Anderson ===");
console.log(JSON.stringify(testHitter, null, 2));
if (testHitter?.source_player_id) {
  const { data: hmRows } = await (sb as any).from("Hitter Master").select("Season, Team, AVG, OBP, SLG, ab").eq("source_player_id", testHitter.source_player_id).order("Season", { ascending: false });
  console.log("His Hitter Master rows:", JSON.stringify(hmRows, null, 2));
  const { data: ssRows } = await (sb as any).from("season_stats").select("*").eq("player_id", testHitter.id);
  console.log("His season_stats rows:", JSON.stringify(ssRows, null, 2));
}
