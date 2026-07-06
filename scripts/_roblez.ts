import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: matches } = await (sb as any).from("players").select("id, first_name, last_name, team, position, pa, ip, is_twp, source_player_id").or("last_name.ilike.%Roblez%,last_name.ilike.%Robles%").limit(10);
console.log("Matches:");
for (const p of (matches || [])) {
  console.log(`  ${p.first_name} ${p.last_name} (${p.team}, ${p.position}) is_twp=${p.is_twp} pa=${p.pa} ip=${p.ip}`);
  console.log(`    player_id: ${p.id}`);
  console.log(`    profile URL: http://localhost:5174/dashboard/${p.position?.match(/^(P|SP|RP)/) ? 'pitcher' : 'player'}/${p.id}`);
}
