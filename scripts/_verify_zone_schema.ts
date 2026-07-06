import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { error: c } = await (sb as any).from("pitch_log").select("pitch_zone").limit(1);
  console.log("pitch_log.pitch_zone:", c ? "MISSING ("+c.message+")" : "OK");
  for (const t of ["pitch_log_pitcher_by_zone","pitch_log_hitter_by_zone"]) {
    const { error } = await (sb as any).from(t).select("*",{count:"exact",head:true});
    console.log(`${t}:`, error ? "MISSING ("+error.message+")" : "OK (table exists)");
  }
})().catch(e=>console.error(e.message));
