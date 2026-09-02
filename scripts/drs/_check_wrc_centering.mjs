/**
 * Q1 subtlety (cross-check flag): does wRC+ center at exactly 100 for a PA-weighted-average hitter?
 * Mean-preservation (fitted mean = actual mean) only holds under the SAME weighting the denom uses.
 * Our regression was fit UNWEIGHTED (per-player); lgwOBA is PA-weighted. Measure the offset, and test
 * whether a PA-WEIGHTED refit makes est_wOBA's PA-weighted mean == lgwOBA exactly (unified anchor).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8")); const WT = W.woba_weights_above_out_scaled;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
// weighted OLS: (X'WX)b = X'Wy, W=diag(w)
function wls(X,y,w){const k=X[0].length;const A=Array.from({length:k},()=>new Array(k+1).fill(0));for(let r=0;r<X.length;r++){const wr=w[r];for(let i=0;i<k;i++){for(let j=0;j<k;j++)A[i][j]+=wr*X[r][i]*X[r][j];A[i][k]+=wr*X[r][i]*y[r];}}
  for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];const pv=A[c][c];for(let j=c;j<=k;j++)A[c][j]/=pv;for(let r=0;r<k;r++){if(r===c)continue;const f=A[r][c];for(let j=c;j<=k;j++)A[r][j]-=f*A[c][j];}}
  return A.map(r=>r[k]);}

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HMall=(await all("Hitter Master","source_player_id,division,pa")).filter(r=>r.division==="D1"&&(r.pa||0)>0);
function build(minPA){const rows=[];for(const h of HMall){if((h.pa||0)<minPA)continue;const row=hs.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);const PA=g("PA");if(PA<=0)continue;
  const HR=g("HR"),T3=g("3B"),T2=g("2B"),Hh=g("H"),BB=g("BB"),HBP=g("HBP");const B1=Math.max(0,Hh-T2-T3-HR);
  const woba=(WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR)/PA;
  rows.push({PA,woba,OBP:g("OBP"),SLG:g("SLG")});}return rows;}
const paw=(rows)=>rows.reduce((s,r)=>s+r.woba*r.PA,0)/rows.reduce((s,r)=>s+r.PA,0);
const allR=build(1), qR=build(100);
const lg_all=paw(allR), lg_q=paw(qR);
console.log(`POPULATION anchors (PA-weighted lgwOBA):`);
console.log(`  all-D1 (every PA>0, n=${allR.length}) = ${lg_all.toFixed(5)}   <- descriptive wRAA centers here`);
console.log(`  qualified (PA>=100, n=${qR.length}) = ${lg_q.toFixed(5)}   <- regulars-only (higher by ${((lg_q-lg_all)).toFixed(4)} wOBA ~ ${((lg_q-lg_all)/0.947*250/13.1).toFixed(2)} WAR at 250 PA)`);

// Fit coeffs on qualified subset (signal), two ways; center against the ALL-D1 anchor (WAR-consistent) and its own.
const X=qR.map(r=>[1,r.OBP,r.SLG]),y=qR.map(r=>r.woba);
const bU=wls(X,y,qR.map(()=>1));                          // unweighted (current fit)
const allX=allR.map(r=>[1,r.OBP,r.SLG]),allY=allR.map(r=>r.woba);
const bWall=wls(allX,allY,allR.map(r=>r.PA));             // PA-weighted fit on ALL D1
const estPAmean=(b,rows)=>rows.reduce((s,r)=>s+(b[0]+b[1]*r.OBP+b[2]*r.SLG)*r.PA,0)/rows.reduce((s,r)=>s+r.PA,0);
console.log(`\nFIT + CENTERING (denom = all-D1 lgwOBA ${lg_all.toFixed(4)}, the WAR-consistent anchor):`);
console.log(`  unweighted fit on PA>=100:  b=[${bU.map(x=>x.toFixed(4)).join(", ")}]  est_wOBA all-D1 PA-mean=${estPAmean(bU,allR).toFixed(5)}  -> wRC+ at all-D1 avg=${(estPAmean(bU,allR)/lg_all*100).toFixed(2)}`);
console.log(`  PA-weighted fit on all-D1:  b=[${bWall.map(x=>x.toFixed(4)).join(", ")}]  est_wOBA all-D1 PA-mean=${estPAmean(bWall,allR).toFixed(5)}  -> wRC+ at all-D1 avg=${(estPAmean(bWall,allR)/lg_all*100).toFixed(2)} (exactly 100 by construction)`);
console.log(`\n=> clean anchor: fit PA-weighted on all-D1, denom = all-D1 lgwOBA ${lg_all.toFixed(4)}, RUNS_PER_PA = ${(lg_all/W.wOBAscale).toFixed(4)}. Coeffs ${bWall[1].toFixed(3)}/${bWall[2].toFixed(3)}.`);
