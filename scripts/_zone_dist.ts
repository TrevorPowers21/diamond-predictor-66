import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const out: Record<string, number> = {};
  for (const z of ["1","2","3","4","5","6","7","8","9","UL","UR","LL","LR"]) {
    const { count } = await (sb as any).from("pitch_log").select("*",{count:"exact",head:true}).eq("pitch_zone", z);
    out[z] = count ?? -1;
  }
  console.log(JSON.stringify(out));
})().catch(e=>console.error(e.message));
