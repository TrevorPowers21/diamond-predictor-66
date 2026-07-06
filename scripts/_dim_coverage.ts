import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  for (const [tbl, dims] of [["pitch_log_pitcher_totals",["all","vs_lhp","vs_rhp","vs_fastball","vs_breaking_ball","vs_offspeed","vs_top_hitters"]],["pitch_log_hitter_totals",["all","vs_lhp","vs_rhp","vs_92plus","vs_fastball","vs_breaking_ball","vs_offspeed","vs_stuff_100plus","vs_stuff_105plus"]]] as const) {
    const parts: string[] = [];
    for (const d of dims) {
      const { count } = await (sb as any).from(tbl).select("*",{count:"exact",head:true}).eq("dimension_key",d);
      parts.push(`${d}:${count}`);
    }
    console.log(`${tbl}\n  ${parts.join("  ")}`);
  }
})().catch(e=>console.error(e.message));
