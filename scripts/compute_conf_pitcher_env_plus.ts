// DRY-RUN (1c): compute pitcher conference env+ on the RATIO scale, clean 30 D1.
// Ratio: lower-better (era/fip/whip/bb9/hr9) = (ncaaMean/rate)*100 ; higher-better (k9) = (rate/ncaaMean)*100.
// Means = ncaa_averages 2026 (whip computed IP-weighted from Pitching Master, absent in ncaa_averages).
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const SEASON = 2026;

// 1) means
const { data: na } = await (sb as any).from("ncaa_averages").select("*").eq("season", SEASON);
const A = na[0];
// WHIP mean: IP-weighted from Pitching Master D1 (paginate)
let ipSum=0, whipIpSum=0, off=0;
// ★ STAGE-0 (2026-08-29): unordered .range() over Pitching Master silently drops/dupes rows -> wrong IP-weighted WHIP mean.
for(;;){ const { data } = await (sb as any).from("Pitching Master").select('"WHIP","IP",division,id').eq("Season",SEASON).eq("division","D1").order("id",{ascending:true}).range(off,off+999);
  if(!data||!data.length) break;
  for(const r of data){ const ip=Number(r.IP)||0, w=Number(r.WHIP); if(ip>0&&Number.isFinite(w)){ ipSum+=ip; whipIpSum+=w*ip; } }
  if(data.length<1000) break; off+=1000; }
const whipMean = whipIpSum/ipSum;
const means:any = { era:A.era, fip:A.fip, whip:whipMean, k9:A.k9, bb9:A.bb9, hr9:A.hr9 };
console.log("RATIO means (ncaa_averages + computed WHIP):", JSON.stringify(Object.fromEntries(Object.entries(means).map(([k,v]:any)=>[k,Number(v).toFixed(4)]))));

// z20 config (current)
const cfg:any = { era:{a:6.21,s:1.587898316,hi:false}, fip:{a:5.08,s:1.000197585,hi:false}, whip:{a:1.64,s:0.2521159606,hi:false}, k9:{a:8.21,s:1.990147058,hi:true}, bb9:{a:4.82,s:1.340745984,hi:false}, hr9:{a:1.12,s:0.4677282102,hi:false} };
const col:any = { era:"ERA",fip:"FIP",whip:"WHIP",k9:"K9",bb9:"BB9",hr9:"HR9" };
const z20=(v:number,c:any)=> Math.round(100+((c.hi?(v-c.a):(c.a-v))/c.s)*20);
const ratio=(v:number,m:number,hi:boolean)=> Math.round(hi ? (v/m)*100 : (m/v)*100);

// 2) conf rows, clean 30
const { data: all } = await (sb as any).from("Conference Stats").select("*").eq("season",SEASON).eq("division","D1");
const rows=(all||[]).filter((r:any)=>!String(r["conference abbreviation"]||"").startsWith("NJCAA")).sort((a:any,b:any)=>(a["conference abbreviation"]||"").localeCompare(b["conference abbreviation"]||""));
console.log(`clean D1 confs: ${rows.length}\n`);
console.log("conf     | era z20/ratio | fip | whip | k9 | bb9 | hr9");
for(const r of rows){
  const cells = ["era","fip","whip","k9","bb9","hr9"].map(m=>{
    const v=r[col[m]]; if(v==null) return "—/—";
    return `${z20(v,cfg[m])}/${ratio(v,means[m],cfg[m].hi)}`;
  });
  console.log(`${(r["conference abbreviation"]||"?").padEnd(8)} | ${cells.join(" | ")}`);
}
// sanity spotlight
const sec=rows.find((r:any)=>r["conference abbreviation"]==="SEC"), ivy=rows.find((r:any)=>r["conference abbreviation"]==="Ivy League");
console.log(`\nSANITY: SEC ERA ${sec?.ERA?.toFixed(2)} -> era+ ratio ${ratio(sec.ERA,means.era,false)} (>100=better pitching, expect yes); Ivy ERA ${ivy?.ERA?.toFixed(2)} -> ${ratio(ivy.ERA,means.era,false)}`);
console.log(`HR9: SEC ${sec?.HR9?.toFixed(2)} -> hr9+ ratio ${ratio(sec.HR9,means.hr9,false)} (SEC gives up many HR -> env+ <100); Ivy ${ivy?.HR9?.toFixed(2)} -> ${ratio(ivy.HR9,means.hr9,false)}`);

// ---- WRITE (clean 30, keyed by conference_id + season). Default dry-run; --apply to persist. ----
const APPLY = process.argv.includes("--apply");
const ratio2=(v:number,m:number,hi:boolean)=> v==null?null:Math.round((hi?(v/m)*100:(m/v)*100)*100)/100; // 2 decimals for SD precision
let wrote=0, skipped=0;
for(const r of rows){
  const cid = r.conference_id; if(!cid){ skipped++; continue; }
  const upd:any = {
    era_plus: ratio2(r.ERA,means.era,false), fip_plus: ratio2(r.FIP,means.fip,false),
    whip_plus: ratio2(r.WHIP,means.whip,false), k9_plus: ratio2(r.K9,means.k9,true),
    bb9_plus: ratio2(r.BB9,means.bb9,false), hr9_plus: ratio2(r.HR9,means.hr9,false),
  };
  if(APPLY){
    const { error } = await (sb as any).from("Conference Stats").update(upd).eq("conference_id",cid).eq("season",SEASON);
    if(error){ console.log(`  ERR ${r["conference abbreviation"]}: ${error.message}`); continue; }
  }
  wrote++;
}
console.log(`\n${APPLY?"APPLIED":"DRY-RUN"}: ${wrote} conf rows ${APPLY?"updated":"would update"}, ${skipped} skipped (no conference_id).`);
