/**
 * AUDIT (read-only) — recompute EVERY NCAA (D1) league average on the corrected Master data,
 * documented weighting, so we save one authoritative set. Compares to the values in the fixtures.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const C = JSON.parse(readFileSync("output/descriptive_constants.json", "utf8"));
const WT = W.woba_weights_above_out_scaled;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

// ---------- HITTERS (aggregate over all D1) ----------
const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HM=(await all("Hitter Master","source_player_id,division")).filter(r=>r.division==="D1");
let sH=0,sAB=0,sBB=0,sHBP=0,sSF=0,s2=0,s3=0,sHR=0,sPA=0,sWobaNum=0, sMetPA=0, sEstPA=0;
for(const h of HM){const row=hs.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);
  const PA=g("PA");if(PA<=0)continue;const AB=g("AB"),H=g("H"),BB=g("BB"),HBP=g("HBP"),SF=g("SF"),T2=g("2B"),T3=g("3B"),HR=g("HR");
  const B1=Math.max(0,H-T2-T3-HR);
  sH+=H;sAB+=AB;sBB+=BB;sHBP+=HBP;sSF+=SF;s2+=T2;s3+=T3;sHR+=HR;sPA+=PA;
  sWobaNum += WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR;
  const OBP=g("OBP"),SLG=g("SLG");
  sMetPA += (0.691*OBP+0.235*SLG)*PA;                 // intercept-less proxy (current-code style)
  sEstPA += (0.011+0.691*OBP+0.235*SLG)*PA;           // est-wOBA WITH intercept (clean style)
}
const lgAVG=sH/sAB, lgSLG=(sH-s2-s3-sHR + 2*s2 + 3*s3 + 4*sHR)/sAB;  // TB = 1B+2·2B+3·3B+4·HR
const lgOBP=(sH+sBB+sHBP)/(sAB+sBB+sHBP+sSF), lgISO=lgSLG-lgAVG;
const lgwOBA=sWobaNum/sPA, denomIntl=sMetPA/sPA, denomEst=sEstPA/sPA;
console.log("=== HITTERS (all D1, aggregate) ===");
console.log(`  n=${HM.length}  ΣPA=${Math.round(sPA)}`);
console.log(`  lgAVG ${lgAVG.toFixed(4)}   lgOBP ${lgOBP.toFixed(4)}   lgSLG ${lgSLG.toFixed(4)}   lgISO ${lgISO.toFixed(4)}`);
console.log(`  lgwOBA ${lgwOBA.toFixed(4)}  (fixture ${W.lgwOBA})   wOBAscale ${W.wOBAscale} (fixture, scale-independent for wRAA)`);
console.log(`  wRC+ denom — intercept-LESS proxy mean = ${denomIntl.toFixed(4)}   |   est-wOBA(with 0.011 intercept) mean = ${denomEst.toFixed(4)}  ≈ lgwOBA ${lgwOBA.toFixed(4)}`);
console.log(`  oWAR RUNS_PER_PA = lgwOBA/wOBAscale = ${(lgwOBA/W.wOBAscale).toFixed(4)}   (ΣR/ΣPA 'runs per PA' 0.163 is a DIFFERENT quantity, wrong for this)`);

// ---------- PITCHERS (aggregate over all D1) ----------
const ps=sheet("docs/drs-reference/Full Season Pitching Master Stats.csv"),pg=ps.gi;
const PM=(await all("Pitching Master","source_player_id,division,IP")).filter(r=>r.division==="D1"&&r.IP>0);
let sIP=0,sER=0,sR=0,sK=0,sBBp=0,sHRp=0,sHBPp=0;
for(const p of PM){const row=ps.rows[String(p.source_player_id)];if(!row)continue;const g=k=>num(row[pg(k)]);
  sIP+=p.IP;sER+=g("ER");sR+=g("R");sK+=g("K");sBBp+=g("BB");sHRp+=g("HR");sHBPp+=g("HBP");}
const lgERA=sER*9/sIP, lgRA9=sR*9/sIP, E2T=sR/sER;
console.log("\n=== PITCHERS (all D1, aggregate, IP-weighted) ===");
console.log(`  n=${PM.length}  ΣIP=${Math.round(sIP)}`);
console.log(`  lgERA ${lgERA.toFixed(3)} (fixture ${C.lgERA})   lgRA9 ${lgRA9.toFixed(3)} (fixture ${C.lgRA9 ?? '?'})   E2T=ΣR/ΣER ${E2T.toFixed(4)} (fixture ${C.E2T})`);
console.log(`  lgK9 ${(sK*9/sIP).toFixed(3)}  lgBB9 ${(sBBp*9/sIP).toFixed(3)}  lgHR9 ${(sHRp*9/sIP).toFixed(3)}  lgHBP9 ${(sHBPp*9/sIP).toFixed(3)}`);
console.log(`  RPW ${C.RPW} (derived from lgRA9, locked) | replacement_RA9 ${C.replacement_RA9} (win%-anchor .380, DERIVED not a mean)`);
console.log("\n(constants file keys: " + Object.keys(C).join(", ") + ")");
