/**
 * V2 COHERENCE TEST (read-only, staging). For pitches where v2 disagrees with the stored label,
 * decide which label is more accurate WITHOUT ground truth: build each label's centroid from the
 * pitches BOTH labelings agree on (unbiased), then measure which centroid the disputed pitch is
 * actually closer to in (armHB, IVB, velo) space. Winner = tighter fit = more accurate label.
 */
import { createClient } from "@supabase/supabase-js";
import { classifyPitcher, primaryFbVelo, armHBof, mean, type P } from "@/savant/lib/stuffPlusClassifierV2";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false} }) as any;
const NORM:Record<string,string>={"4-Seam Fastball":"4S FB","Four-Seam Fastball":"4S FB"};
const norm=(s:string|null)=>s==null?null:(NORM[s]??s);
const SAMPLE=Number(process.argv[process.argv.indexOf("--sample")+1]||150);

async function main(){
  const {data:pf}=await sb.from("_reclass_pf").select("pitcher_id").order("pitcher_id").limit(1000);
  const ids=(pf??[]).map((r:any)=>r.pitcher_id); const step=Math.max(1,Math.floor(ids.length/SAMPLE));
  const sample=ids.filter((_:any,i:number)=>i%step===0).slice(0,SAMPLE);
  let v2Win=0, stWin=0, tie=0, disputed=0, agreed=0, pitchers=0;
  const byMove:Record<string,{v2:number;st:number}>={};
  for(const pid of sample){
    const rows:any[]=[]; let last="";
    for(;;){const {data}=await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified").eq("pitcher_id",pid).eq("season",2026).gt("uniq_pitch_id",last).order("uniq_pitch_id").limit(1000);
      if(!data||!data.length)break; rows.push(...data); last=data[data.length-1].uniq_pitch_id; if(data.length<1000)break;}
    const us:P[]=rows.filter(r=>r.release_velocity!=null&&r.ivb_corrected!=null&&r.hb_corrected!=null&&r.pitch_type_reclassified)
      .map(r=>({uniq:r.uniq_pitch_id,raw:r.pitch_type,hand:r.pitcher_hand,velo:r.release_velocity,ivb:r.ivb_corrected,hb:r.hb_corrected,spin:r.spin,stored:norm(r.pitch_type_reclassified)}));
    if(us.length<80)continue; pitchers++;
    const lab=classifyPitcher(us,primaryFbVelo(us));
    const feat=(p:P)=>[armHBof(p.hb,p.hand), p.ivb, p.velo] as [number,number,number];
    // centroids from AGREED pitches only (unbiased)
    const agg:Record<string,[number,number,number][]>={};
    for(const p of us){const v=lab.get(p.uniq)?.label; if(v&&v===p.stored){(agg[v]??=[]).push(feat(p)); agreed++;}}
    const cent:Record<string,[number,number,number]>={};
    for(const [k,v] of Object.entries(agg)) if(v.length>=5) cent[k]=[mean(v.map(x=>x[0])),mean(v.map(x=>x[1])),mean(v.map(x=>x[2]))];
    const d=(a:[number,number,number],b:[number,number,number])=>Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+((a[2]-b[2])*0.7)**2);
    for(const p of us){
      const v=lab.get(p.uniq)?.label, s=p.stored;
      if(!v||!s||v===s)continue;
      const cv=cent[v], cs=cent[s]; if(!cv||!cs)continue;
      disputed++;
      const f=feat(p), dv=d(f,cv), ds=d(f,cs);
      const key=`${s} → ${v}`; (byMove[key]??={v2:0,st:0});
      if(Math.abs(dv-ds)<0.5){tie++;}
      else if(dv<ds){v2Win++; byMove[key].v2++;}
      else {stWin++; byMove[key].st++;}
    }
  }
  console.log(`\n=== V2 COHERENCE TEST (staging, read-only) ===`);
  console.log(`${pitchers} pitchers | ${agreed} agreed pitches (centroid basis) | ${disputed} DISPUTED pitches evaluated\n`);
  const dec=v2Win+stWin;
  console.log(`v2's label is CLOSER (more accurate): ${v2Win}/${dec} = ${(100*v2Win/dec).toFixed(1)}%`);
  console.log(`stored label is closer:                ${stWin}/${dec} = ${(100*stWin/dec).toFixed(1)}%`);
  console.log(`too close to call (<0.5):              ${tie}`);
  console.log(`\nVERDICT: ${v2Win>stWin*1.2?"v2 is BETTER on disputed pitches":stWin>v2Win*1.2?"STORED is better — do NOT overwrite":"MIXED / inconclusive"}`);
  console.log(`\nper-move breakdown (stored → v2)   [v2 wins / stored wins]:`);
  Object.entries(byMove).filter(([,x])=>x.v2+x.st>=20).sort((a,b)=>(b[1].v2+b[1].st)-(a[1].v2+a[1].st)).slice(0,12)
    .forEach(([k,x])=>{const t=x.v2+x.st;console.log(`  ${k.padEnd(28)} ${String(x.v2).padStart(5)} / ${String(x.st).padStart(5)}   → ${x.v2>x.st?"v2":"stored"} wins (${(100*Math.max(x.v2,x.st)/t).toFixed(0)}%)`);});
}
main().catch(e=>{console.error(e.message);process.exit(1);});
