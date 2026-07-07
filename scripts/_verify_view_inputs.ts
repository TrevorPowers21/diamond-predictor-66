import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const div = (n:number|null,d:number|null)=> d!=null&&d>0?(n??0)/d:null;
const fmt = (v:number|null,m=1,dp=1)=> v==null?"":(v*m).toFixed(dp);
const LABELS=["Stuff+","Whiff%","BB%","HH%","IZWhiff%","Chase%","Barrel%","LD%","AvgEV","GB%","IZ%","EV90","Pull%","LA10-30"];
(async()=>{
  const { data } = await (sb as any).from("pitch_log_pitcher_totals").select("*")
    .eq("dimension_key","all").eq("season",2026).gte("total_pitches",100)
    .order("total_pitches",{ascending:false}).limit(3);
  for (const r of data ?? []) {
    const ev=r.batted_balls_allowed_with_ev;
    const inputs=[
      fmt(div(r.stuff_plus_sum,r.stuff_plus_data_pitches),1,1),
      fmt(div(r.total_whiffs,r.total_swings),100), fmt(div(r.total_bb,r.total_pa),100),
      fmt(div(r.batted_hard_hit_allowed,ev),100), fmt(div(r.total_in_zone_whiffs,r.total_in_zone_swings),100),
      fmt(div(r.total_chases,r.total_out_of_zone),100), fmt(div(r.batted_barrels_allowed,ev),100),
      fmt(div(r.batted_line_drives_allowed,ev),100), fmt(div(r.ev_sum_allowed,ev),1,1),
      fmt(div(r.batted_ground_balls_allowed,ev),100), fmt(div(r.total_in_zone,r.total_in_zone+r.total_out_of_zone),100),
      r.ev_90_allowed==null?"":Number(r.ev_90_allowed).toFixed(1),
      fmt(div(r.batted_pull_allowed,r.batted_pull_allowed+r.batted_center_allowed+r.batted_oppo_allowed),100), fmt(div(r.batted_la_10_to_30_allowed,ev),100),
    ];
    const empties = inputs.map((v,i)=>v===""?LABELS[i]:null).filter(Boolean);
    console.log(`pitcher ${r.pitcher_id} (${r.total_pitches}p):`);
    console.log("  "+LABELS.map((l,i)=>`${l}=${inputs[i]||"—"}`).join("  "));
    console.log("  empty inputs:", empties.length?empties.join(","):"NONE -> rating will compute");
  }
})().catch(e=>console.error(e.message));
