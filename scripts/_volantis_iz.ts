import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: pl } = await (sb as any).from("players").select("id, source_player_id, first_name, last_name, team").ilike("last_name","%Volantis%").limit(3);
  console.log("player:", JSON.stringify(pl));
  const sid = pl?.[0]?.source_player_id;
  if (!sid) return;
  const { data: pm } = await (sb as any).from("Pitching Master").select("Season, in_zone_pct, stuff_plus, \"90th_vel\", h_pull_pct, la_10_30_pct").eq("source_player_id", sid).order("Season",{ascending:false});
  console.log("Pitching Master rows:");
  for (const r of pm ?? []) console.log(`  ${r.Season}: in_zone_pct=${r.in_zone_pct} stuff=${r.stuff_plus} 90thvel=${r["90th_vel"]} hpull=${r.h_pull_pct} la=${r.la_10_30_pct}`);
  const { data: plog } = await (sb as any).from("pitch_log_pitcher_totals").select("dimension_key,total_in_zone,total_out_of_zone,total_pitches").eq("pitcher_id", sid).eq("dimension_key","all");
  for (const r of plog ?? []) console.log(`  pitch_log(2026): IZ%=${((r.total_in_zone/(r.total_in_zone+r.total_out_of_zone))*100).toFixed(1)}  (in=${r.total_in_zone} ooz=${r.total_out_of_zone} pitches=${r.total_pitches})`);
})().catch(e=>console.error(e.message));
