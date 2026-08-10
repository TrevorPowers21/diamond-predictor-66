/**
 * (a) Does projection oWAR (wRC+ × 0.3994) reproduce descriptive oWAR FLATLY — not just in the grand mean?
 * The old bug was invisible in the middle and huge at the tails, and the walk-rate cut is where an index
 * hides slash bias. PASS = flat |error| across wRC+ bands, PA bands, AND BB% quartiles. A 0.04 grand mean
 * with a 0.3 tail is a FAIL.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const L = JSON.parse(readFileSync("output/ncaa_league_averages_2026.json", "utf8"));
const lgwOBA=0.3782, WSCALE=L.hitting.wOBAscale.value, RPW=L.war_constants.RPW.value, RPP=lgwOBA/WSCALE;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HM=(await all("Hitter Master","source_player_id,division,pa,desc_owar")).filter(r=>r.division==="D1"&&r.desc_owar!=null&&(r.pa||0)>=50);
const rows=[];
for(const h of HM){const row=hs.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);const PA=g("PA");
  const wrc=(0.011+0.691*g("OBP")+0.235*g("SLG"))/lgwOBA*100;
  const proj=((wrc/100-1)*PA*RPP + (PA/600)*2.0*RPW)/RPW;
  const bbpct = g("BB")/PA;
  rows.push({PA,wrc,resid:proj-h.desc_owar,bbpct});}

function seg(label, keyOf, bins){
  console.log(`\n  by ${label}:`);
  for(const b of bins){const s=rows.filter(r=>keyOf(r)>=b.lo&&keyOf(r)<b.hi);if(!s.length)continue;
    const mAbs=s.reduce((a,r)=>a+Math.abs(r.resid),0)/s.length;
    const mSig=s.reduce((a,r)=>a+r.resid,0)/s.length;
    console.log(`    ${b.name.padEnd(14)} n=${String(s.length).padStart(4)}   mean|err| ${mAbs.toFixed(3)}   signed ${mSig>=0?'+':''}${mSig.toFixed(3)}`);}
}
const gAbs=rows.reduce((a,r)=>a+Math.abs(r.resid),0)/rows.length;
console.log(`GRAND (n=${rows.length}):  mean|err| ${gAbs.toFixed(3)}   signed ${(rows.reduce((a,r)=>a+r.resid,0)/rows.length).toFixed(3)}  (RPP=${RPP.toFixed(4)})`);
seg("wRC+ band", r=>r.wrc, [{name:"<80",lo:-1e9,hi:80},{name:"80-95",lo:80,hi:95},{name:"95-105",lo:95,hi:105},{name:"105-120",lo:105,hi:120},{name:"120-140",lo:120,hi:140},{name:">=140",lo:140,hi:1e9}]);
seg("PA band", r=>r.PA, [{name:"50-120",lo:50,hi:120},{name:"120-200",lo:120,hi:200},{name:"200-260",lo:200,hi:260},{name:">=260",lo:260,hi:1e9}]);
const bbs=rows.map(r=>r.bbpct).sort((a,b)=>a-b);const q=p=>bbs[Math.floor(bbs.length*p)];
seg("BB% quartile", r=>r.bbpct, [{name:`Q1<${(q(.25)*100).toFixed(0)}%`,lo:-1,hi:q(.25)},{name:"Q2",lo:q(.25),hi:q(.5)},{name:"Q3",lo:q(.5),hi:q(.75)},{name:`Q4>${(q(.75)*100).toFixed(0)}%`,lo:q(.75),hi:1e9}]);
