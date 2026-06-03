import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const env = url.includes("trbvxuoliwrfowibatkm") ? "PROD" : url.includes("slrxowawbijbjrkozqlj") ? "STAGING" : "UNKNOWN";
console.log(`Connecting to: ${url} (${env})\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

// 1. How many JUCO players in the players table?
const { count: jucoPlayerCount } = await (sb as any)
  .from("players")
  .select("id", { count: "exact", head: true })
  .eq("division", "NJCAA_D1");
console.log(`JUCO players in players table: ${jucoPlayerCount}\n`);

// 2. JUCO player_predictions distribution: how many rows, by variant/season/model_type
const { data: predDist } = await (sb as any)
  .from("player_predictions")
  .select("model_type, variant, season, customer_team_id, players!inner(division)")
  .eq("players.division", "NJCAA_D1")
  .range(0, 9999);
const buckets: Record<string, number> = {};
for (const r of predDist ?? []) {
  const k = `model_type=${r.model_type} variant=${r.variant} season=${r.season} customer=${r.customer_team_id ? "team" : "null"}`;
  buckets[k] = (buckets[k] ?? 0) + 1;
}
console.log(`Sampled ${predDist?.length ?? 0} JUCO prediction rows. Distribution:`);
for (const [k, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(5)}  ${k}`);

// 3. Sample JUCO player + their predictions
const { data: sampleJuco } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, division, pa, ip, source_player_id")
  .eq("division", "NJCAA_D1")
  .not("pa", "is", null)
  .gte("pa", 75)
  .limit(3);
console.log(`\n=== Sample JUCO hitters (PA>=75) ===`);
for (const p of sampleJuco ?? []) {
  console.log(`\n${p.first_name} ${p.last_name} - ${p.team} - PA=${p.pa}`);
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("model_type, variant, season, customer_team_id, p_avg, p_obp, p_slg, p_wrc_plus, o_war, from_avg, from_obp, from_slg, updated_at")
    .eq("player_id", p.id);
  if (!preds || preds.length === 0) {
    console.log("  NO prediction rows");
  } else {
    for (const pr of preds) {
      console.log(`  ${pr.model_type}/${pr.variant} season=${pr.season} customer=${pr.customer_team_id ?? "null"}  p_avg=${pr.p_avg} p_wrc_plus=${pr.p_wrc_plus} o_war=${pr.o_war} from_avg=${pr.from_avg} updated_at=${pr.updated_at?.slice(0, 16)}`);
    }
  }
}
