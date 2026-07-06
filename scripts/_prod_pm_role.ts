import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
for (const sid of ["1327017728","1299957248","1092652800"]) {
  const { data } = await (sb as any).from("Pitching Master").select("Season, Role, ERA, G, GS").eq("source_player_id", sid).order("Season", { ascending: false }).limit(3);
  console.log(`sid=${sid}:`);
  for (const r of (data || [])) console.log(`  ${r.Season}: Role=${r.Role} G=${r.G} GS=${r.GS} ERA=${r.ERA}`);
}
