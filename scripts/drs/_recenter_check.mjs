/**
 * (b) Re-center the offensive baseline on ALL-D1, consistently, and confirm the three run-above-average
 * constructions COLLAPSE to one number (seam closed).
 * The physics = raw run values above OUT (woba_runs = WT/wOBAscale), invariant. The SEAM is the centering
 * constant lg_raw: the fixture's linear_weights_above_avg out-weight uses lg_raw=0.4154 (RE24-sample
 * centered), but wOBAscale/RUNS_PER_PA use lg_raw=lgwOBA/wOBAscale (pa_total centered). Fix: ONE lg_raw,
 * computed over all D1 with a consistent denominator.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const WT = W.woba_weights_above_out_scaled, WSCALE = W.wOBAscale;
const LWA_fix = W.linear_weights_above_avg;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

// physics: raw run values above OUT
const raw = {}; for (const e of ["BB","HBP","1B","2B","3B","HR"]) raw[e] = WT[e]/WSCALE;   // out = 0

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HM=(await all("Hitter Master","source_player_id,division,pa")).filter(r=>r.division==="D1");

// lg_raw over ALL D1, ONE consistent denominator: Σ(raw·events)/ΣPA
let sRaw=0, sPA=0, sOBPnum=0;
const recs=[];
for(const h of HM){const row=hs.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);const PA=g("PA");if(PA<=0)continue;
  const HR=g("HR"),T3=g("3B"),T2=g("2B"),Hh=g("H"),BB=g("BB"),HBP=g("HBP");const B1=Math.max(0,Hh-T2-T3-HR);
  const rawRuns = raw.BB*BB+raw.HBP*HBP+raw["1B"]*B1+raw["2B"]*T2+raw["3B"]*T3+raw.HR*HR;
  sRaw += rawRuns; sPA += PA; sOBPnum += (Hh+BB+HBP);
  recs.push({name:(row[hg("playerFullName")]||"").trim(),PA,BB,HBP,B1,T2,T3,HR,OBP:g("OBP"),SLG:g("SLG")});}
const lg_raw_allD1 = sRaw/sPA;
const lgOBP_allD1 = sOBPnum/sPA;
const lgwOBA_allD1 = lg_raw_allD1*WSCALE;   // by construction wOBA sits on scaled raw

console.log("SEAM:");
console.log(`  fixture out-weight implies lg_raw = ${(-LWA_fix.out).toFixed(4)}   (RE24-sample centered)`);
console.log(`  fixture wOBAscale implies lg_raw = lgwOBA/scale = ${(W.lgwOBA/WSCALE).toFixed(4)}   (pa_total centered)`);
console.log(`  ALL-D1 consistent lg_raw (Σraw/ΣPA) = ${lg_raw_allD1.toFixed(4)}   <-- the ONE correct baseline`);
console.log(`  => corrected out-weight = ${(-lg_raw_allD1).toFixed(4)} (was ${LWA_fix.out}); RUNS_PER_PA = lg_raw = ${lg_raw_allD1.toFixed(4)}`);
console.log(`     lgOBP all-D1 ${lgOBP_allD1.toFixed(4)}  lgwOBA(=lg_raw*scale) ${lgwOBA_allD1.toFixed(4)}\n`);

// corrected linear weights (above avg) = raw - lg_raw_allD1
const lwaNew = {}; for (const e of ["BB","HBP","1B","2B","3B","HR"]) lwaNew[e] = raw[e]-lg_raw_allD1; lwaNew.out = -lg_raw_allD1;
const RPP = lg_raw_allD1;

console.log("THREE-WAY runs-above-average with the CORRECTED centering (must collapse):");
for(const nm of ["hairston","helfrick","advincula"]){
  const r=recs.find(x=>x.name.toLowerCase().includes(nm)); if(!r)continue;
  const outs=r.PA-r.B1-r.T2-r.T3-r.HR-r.BB-r.HBP;
  const re24=lwaNew.BB*r.BB+lwaNew.HBP*r.HBP+lwaNew["1B"]*r.B1+lwaNew["2B"]*r.T2+lwaNew["3B"]*r.T3+lwaNew.HR*r.HR+lwaNew.out*outs;
  const woba=(WT.BB*r.BB+WT.HBP*r.HBP+WT["1B"]*r.B1+WT["2B"]*r.T2+WT["3B"]*r.T3+WT.HR*r.HR)/r.PA;
  const wobaM=(woba-lgwOBA_allD1)/WSCALE*r.PA;
  const wrc=(0.011+0.691*r.OBP+0.235*r.SLG)/lgwOBA_allD1*100;
  const wrcM=(wrc/100-1)*r.PA*RPP;
  console.log(`  ${r.name.padEnd(20)} RE24 ${re24.toFixed(1).padStart(6)}   wOBA-method ${wobaM.toFixed(1).padStart(6)}   wRC+×RPP ${wrcM.toFixed(1).padStart(6)}`);
}
console.log(`\n  (RE24 vs wOBA-method should now match to <0.1; wRC+ column carries only the ~2% wRC+ proxy error.)`);
console.log(`  descriptive level shift from the seam fix: the WAR path used WT+lgwOBA+wOBAscale (already pa_total-centered),`);
console.log(`  so desc_owar is UNCHANGED; only the display linear_weights_above_avg out-weight was off (${LWA_fix.out} -> ${(-lg_raw_allD1).toFixed(4)}).`);
