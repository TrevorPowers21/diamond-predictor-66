import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  for (const [t,dims] of [["pitch_log_pitcher_by_zone",["all","vs_lhp","vs_rhp","vs_fastball","vs_breaking_ball","vs_offspeed","vs_top_hitters"]],["pitch_log_hitter_by_zone",["all","vs_lhp","vs_rhp","vs_92plus","vs_fastball","vs_breaking_ball","vs_offspeed","vs_stuff_100plus","vs_stuff_105plus"]]] as const) {
    const parts:string[]=[];
    for (const d of dims){ const {count}=await (sb as any).from(t).select("*",{count:"exact",head:true}).eq("dimension_key",d); parts.push(`${d}:${count}`);}
    console.log(`${t}\n  ${parts.join("  ")}`);
  }
  // sample pitcher's 13-zone breakdown (all dim) — Volantis
  const { data } = await (sb as any).from("pitch_log_pitcher_by_zone")
    .select("pitch_zone, pitches, whiffs, swings, ev_90, x_woba_sum_allowed")
    .eq("pitcher_id","1979617275").eq("dimension_key","all").order("pitch_zone");
  console.log("\nVolantis by-zone (all):");
  for (const r of data ?? []) console.log(`  zone ${r.pitch_zone}: ${r.pitches}p whiff%=${r.swings?((r.whiffs/r.swings)*100).toFixed(0):"-"} ev90=${r.ev_90??"-"}`);
})().catch(e=>console.error(e.message));
