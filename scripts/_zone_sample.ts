import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await (sb as any).from("pitch_log").select("uniq_pitch_id, pitch_zone").not("pitch_zone","is",null).limit(3);
  console.log("committed rows so far:", data && data.length ? `YES (e.g. zone=${data.map((r:any)=>r.pitch_zone).join(",")})` : "none yet");
})().catch(e=>console.error(e.message));
