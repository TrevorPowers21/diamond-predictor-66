import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Check Roblez (SR → should be GR now)
console.log("=== Roblez (SR) — all 2027 rows ===");
const { data: roblez } = await (sb as any).from("player_predictions").select("variant, customer_team_id, class_transition").eq("player_id", "03dd3c82-b85a-43a0-9815-89403d253a2e").eq("season", 2027);
for (const r of (roblez || [])) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0,8) : "(global)";
  console.log(`  ${r.variant.padEnd(11)} team=${team.padEnd(10)} ct=${r.class_transition}`);
}

// Check overall ct distribution on staging
console.log("\n=== Class transition distribution on staging 2027 ===");
const ct: Record<string,number> = {};
let from = 0;
while (true) {
  const { data } = await (sb as any).from("player_predictions").select("class_transition, players!inner(class_year)").eq("season", 2027).range(from, from+999);
  if (!data || data.length === 0) break;
  for (const r of data) {
    const key = `${r.players?.class_year ?? "?"} → ${r.class_transition ?? "NULL"}`;
    ct[key] = (ct[key]||0) + 1;
  }
  if (data.length < 1000) break;
  from += 1000;
}
for (const [k,v] of Object.entries(ct).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
