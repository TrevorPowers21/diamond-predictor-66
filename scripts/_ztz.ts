import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { count } = await (sb as any).from("pitch_log_pitcher_by_zone").select("*",{count:"exact",head:true}).eq("dimension_key","vs_top_hitters");
  console.log("by_zone vs_top_hitters rows:", count);
})().catch(e=>console.error(e.message));
