import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { count: twpCount } = await (sb as any).from("players").select("*", { count: "exact", head: true }).eq("is_twp", true);
console.log(`TWPs on staging: ${twpCount}`);

// Sample 5 TWPs with their 2027 prediction rows
const { data: twps } = await (sb as any).from("players").select("id, first_name, last_name, team, position, pa, ip, is_twp").eq("is_twp", true).limit(5);
console.log("\nSample TWPs:");
for (const p of (twps ?? [])) {
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("variant, customer_team_id, p_wrc_plus, o_war, p_era, p_war, market_value")
    .eq("player_id", p.id).eq("season", 2027);
  console.log(`  ${p.first_name} ${p.last_name} (${p.team}, ${p.position}, PA=${p.pa} IP=${p.ip})`);
  for (const r of (preds ?? [])) {
    console.log(`    ${r.variant.padEnd(11)} team=${r.customer_team_id?.slice(0,8) ?? "(global)"} | oWAR=${r.o_war} pWAR=${r.p_war} | MV=${r.market_value}`);
  }
}

// What's the 1 customer team?
const { data: team } = await (sb as any).from("customer_teams").select("id, name").limit(1);
console.log("\nCustomer team:", JSON.stringify(team, null, 2));
