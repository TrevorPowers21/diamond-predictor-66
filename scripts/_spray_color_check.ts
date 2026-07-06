import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const COL=[-45,-30,-15,15,30,45]; const N=["LF","LC","CF","RC","RF"];
function arc(th:number){const c=Math.cos(th*Math.PI/180);return (121*c+Math.sqrt(121*c*121*c+21459))/2;}
function bandFills(vals:number[],cnts:number[]){
  const pres=vals.filter((_,i)=>cnts[i]>0); if(!pres.length)return vals.map(()=>"NEUTRAL");
  const mean=pres.reduce((a,b)=>a+b,0)/pres.length; const spread=Math.max(...pres.map(v=>Math.abs(v-mean)),1e-9);
  return vals.map((v,i)=>{if(cnts[i]===0)return "NEUTRAL"; const p=Math.max(0,Math.min(100,50+50*(v-mean)/spread)); return `${p>=50?"RED":"BLU"}(${p.toFixed(0)})`;});
}
(async()=>{
  const {data}=await (sb as any).from("pitch_log").select("spray_ang,distance,exit_velocity")
    .eq("pitcher_id","1979617275").eq("is_batted_ball_in_play",true).not("spray_ang","is",null).limit(2000);
  const sum=[[0,0,0,0,0],[0,0,0,0,0]],cnt=[[0,0,0,0,0],[0,0,0,0,0]];
  for(const r of data??[]){const a=r.spray_ang; if(a<-45||a>45)continue; let c=0; while(c<4&&a>COL[c+1])c++;
    const b=(r.distance!=null&&r.distance<=arc(a))?0:1; cnt[b][c]++; if(r.exit_velocity!=null)sum[b][c]+=r.exit_velocity;}
  const tot=cnt[0].reduce((a,b)=>a+b,0)+cnt[1].reduce((a,b)=>a+b,0);
  for(const band of [0,1]){
    const freqV=cnt[band].map(c=>c/tot*100);
    const evV=sum[band].map((s,i)=>cnt[band][i]>0?s/cnt[band][i]:0);
    console.log(`${band?"OUTFIELD":"INFIELD "}  cnt=[${cnt[band].join(",")}]`);
    console.log(`  FREQ%=[${freqV.map(v=>v.toFixed(1)).join(",")}] -> ${bandFills(freqV,cnt[band]).join(" ")}`);
    console.log(`  AVGEV=[${evV.map(v=>v.toFixed(0)).join(",")}] -> ${bandFills(evV,cnt[band]).join(" ")}`);
  }
})().catch(e=>console.error(e.message));
