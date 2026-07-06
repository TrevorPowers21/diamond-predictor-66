import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  for (const t of ["pitch_log_pitcher_totals","pitch_log_pitcher_by_pitch_type","pitch_log_pitcher_by_zone"]) {
    const { count } = await (sb as any).from(t).select("*",{count:"exact",head:true}).eq("dimension_key","vs_top_hitters");
    process.stdout.write(`${t.replace("pitch_log_pitcher_","")}=${count} `);
  }
  console.log("");
})().catch(e=>console.error(e.message));
