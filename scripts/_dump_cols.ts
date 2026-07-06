import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  for (const t of ["pitch_log_pitcher_by_pitch_type","pitch_log_hitter_by_pitch_type"]) {
    const { data } = await (sb as any).from(t).select("*").limit(1).maybeSingle();
    console.log(`\n=== ${t} (${data?Object.keys(data).length:0} cols) ===`);
    console.log(data ? Object.keys(data).join(", ") : "no row");
  }
})().catch(e=>console.error(e.message));
