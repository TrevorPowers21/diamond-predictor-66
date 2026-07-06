import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Pitcher preds by customer_team_id
const { data } = await (sb as any).from("player_predictions").select("customer_team_id, variant").eq("season", 2027).not("p_era", "is", null).limit(20000);
const dist: Record<string, number> = {};
for (const r of (data || [])) {
  const k = `team=${r.customer_team_id?.slice(0,8) ?? "NULL_GLOBAL"} variant=${r.variant}`;
  dist[k] = (dist[k] || 0) + 1;
}
console.log("Pitcher preds (p_era NOT NULL) breakdown:");
for (const [k,v] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(40)} ${v}`);

// Georgia customer_team_id
console.log("\nGeorgia customer_team_id: 3b1cc0e2-4acd-4a27-a7bc-d345c347f18d");
console.log("(short: 3b1cc0e2)");
