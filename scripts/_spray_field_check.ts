import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const COL=[-45,-30,-15,15,30,45]; const NAMES=["LF","LC","CF","RC","RF"];
function arcDistance(th:number){const c=Math.cos(th*Math.PI/180);return (121*c+Math.sqrt(121*c*121*c+21459))/2;}
(async()=>{
  // high-BIP pitcher: Volantis
  const { data } = await (sb as any).from("pitch_log")
    .select("spray_ang, distance, exit_velocity, pitch_result_category")
    .eq("pitcher_id","1979617275").eq("is_batted_ball_in_play",true).not("spray_ang","is",null).limit(2000);
  const inf=[0,0,0,0,0], out=[0,0,0,0,0]; let noDist=0;
  for(const r of data??[]){const a=r.spray_ang; if(a<-45||a>45)continue; let col=0; while(col<4&&a>COL[col+1])col++;
    const band=(r.distance!=null&&r.distance<=arcDistance(a))?inf:out; band[col]++; if(r.distance==null)noDist++;}
  const tot=inf.reduce((x,y)=>x+y,0)+out.reduce((x,y)=>x+y,0);
  console.log("Volantis BIP:",tot,"(no-distance:",noDist+")");
  console.log("shallow(inf):", NAMES.map((n,i)=>`${n}:${inf[i]}`).join(" "));
  console.log("deep(out):   ", NAMES.map((n,i)=>`${n}:${out[i]}`).join(" "));
  // spot-check: HRs (should be deep) + popups (should be shallow)
  const hr=(data??[]).filter((r:any)=>r.pitch_result_category==="HR").slice(0,3);
  for(const r of hr)console.log(`  HR spray=${r.spray_ang} dist=${r.distance} -> ${r.distance<=arcDistance(r.spray_ang)?"SHALLOW":"DEEP"} (arc=${arcDistance(r.spray_ang).toFixed(0)})`);
})().catch(e=>console.error(e.message));
