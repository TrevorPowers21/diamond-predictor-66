import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await (sb as any).from("pitch_log_hitter_totals")
    .select("batter_id, pa, ev_90, batted_pull, batted_center, batted_oppo, batted_balls_with_ev")
    .eq("dimension_key","all").eq("season",2026).gte("pa",100).order("pa",{ascending:false}).limit(5);
  for (const r of data ?? []) {
    const dir=(r.batted_pull??0)+(r.batted_center??0)+(r.batted_oppo??0);
    const pull = dir>0 ? ((r.batted_pull/dir)*100).toFixed(1) : "—";
    console.log(`batter ${r.batter_id} pa=${r.pa}  EV90=${r.ev_90}  pull%=${pull}  (pull/cen/opp=${r.batted_pull}/${r.batted_center}/${r.batted_oppo})`);
  }
})().catch(e=>console.error(e.message));
