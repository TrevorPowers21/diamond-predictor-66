import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
for (const sid of ["1327017728","1299957248","1092652800"]) {
  const { data: p } = await (sb as any).from("players").select("id, first_name, last_name, team, position").eq("source_player_id", sid).maybeSingle();
  console.log(`${p?.first_name} ${p?.last_name} (${p?.team}, ${p?.position})`);
  console.log(`  player_id: ${p?.id}`);
  console.log(`  URL: /dashboard/pitcher/${p?.id}`);
}
