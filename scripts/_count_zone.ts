import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { count } = await (sb as any).from("pitch_log").select("*",{count:"exact",head:true}).not("pitch_zone","is",null);
  console.log("pitch_zone labeled:", count);
})().catch(e=>console.error(e.message));
