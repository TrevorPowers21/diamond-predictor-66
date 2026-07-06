import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sids = ["1327017728","1299957248","1092652800"];
for (const sid of sids) {
  const { data } = await (sb as any).from("Pitching Master").select("source_player_id, Season, Role, ERA, FIP, K9, BB9, stuff_plus, era_pr_plus, fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus").eq("source_player_id", sid).order("Season", { ascending: false }).limit(3);
  console.log(`sid=${sid}:`);
  for (const r of (data || [])) console.log(`  ${r.Season}: Role=${r.Role} ERA=${r.ERA} era_pr_plus=${r.era_pr_plus} fip_pr_plus=${r.fip_pr_plus} stuff_plus=${r.stuff_plus}`);
}
