import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const seasons = [2026, 2027];
for (const season of seasons) {
  const { count: total } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("season", season);
  const { count: withPower } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .not("power_rating_plus", "is", null);
  const { count: withScore } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .not("power_rating_score", "is", null);
  console.log(`season=${season}: total=${total}, power_rating_plus populated=${withPower}, power_rating_score populated=${withScore}`);
}

console.log("\nHitter Master 2026 power-rating columns sample:");
const { data: hm } = await (sb as any)
  .from("Hitter Master")
  .select("source_player_id, playerFullName, Season, overall_power_rating, ba_power_rating, obp_power_rating, iso_power_rating")
  .eq("Season", 2026)
  .order("overall_power_rating", { ascending: false, nullsFirst: false })
  .limit(3);
console.log(JSON.stringify(hm, null, 2));

const { count: hmTotal } = await (sb as any).from("Hitter Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026);
const { count: hmWithOverall } = await (sb as any).from("Hitter Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026).not("overall_power_rating", "is", null);
console.log(`\nHitter Master 2026: total=${hmTotal}, with overall_power_rating=${hmWithOverall}`);

const { count: pmTotal } = await (sb as any).from("Pitching Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026);
const { count: pmWithPr } = await (sb as any).from("Pitching Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026).not("overall_pr_plus", "is", null);
console.log(`Pitching Master 2026: total=${pmTotal}, with overall_pr_plus=${pmWithPr}`);
