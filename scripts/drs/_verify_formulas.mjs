/**
 * FRESH re-derivation (read-only) of the two LOCKED projection quality metrics on the CORRECTED
 * (post-CSV-fix) Master data — confirm the coefficients we settled on pre-fix still hold.
 *   HITTER  wRC+ : OLS  wOBA ~ OBP + SLG   (locked 0.691·OBP + 0.235·SLG, corr 0.996)
 *   PITCHER FIP  : OLS  ERA  ~ K9 + BB9 + HR9  and HBP-folded ERA ~ K9 + (BB9+HBP9) + HR9
 *                  (locked 3.10 − 0.231·K9 + 0.509·(BB9+HBP9) + 1.486·HR9, |Δ|→RA9 0.30)
 * Independent of the old temp scripts. Uses the same quote-aware sheet + D1 filter as populate.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const WT = W.woba_weights_above_out_scaled;
const E2T = JSON.parse(readFileSync("output/descriptive_constants.json", "utf8")).E2T;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
// OLS via normal equations (Gauss-Jordan on X'X | X'y). X rows include the intercept column.
function ols(X,y){const k=X[0].length;const A=Array.from({length:k},()=>new Array(k+1).fill(0));for(let r=0;r<X.length;r++){for(let i=0;i<k;i++){for(let j=0;j<k;j++)A[i][j]+=X[r][i]*X[r][j];A[i][k]+=X[r][i]*y[r];}}
  for(let c=0;c<k;c++){let p=c;for(let r=c+1;r<k;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];const pv=A[c][c];for(let j=c;j<=k;j++)A[c][j]/=pv;for(let r=0;r<k;r++){if(r===c)continue;const f=A[r][c];for(let j=c;j<=k;j++)A[r][j]-=f*A[c][j];}}
  return A.map(r=>r[k]);}
function r2(X,y,b){const yb=y.reduce((s,x)=>s+x,0)/y.length;let ss=0,sr=0;for(let r=0;r<X.length;r++){const yh=X[r].reduce((s,v,i)=>s+v*b[i],0);sr+=(y[r]-yh)**2;ss+=(y[r]-yb)**2;}return 1-sr/ss;}
const corr=(a,b)=>{const n=a.length,ma=a.reduce((s,x)=>s+x,0)/n,mb=b.reduce((s,x)=>s+x,0)/n;let c=0,va=0,vb=0;for(let i=0;i<n;i++){c+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;}return c/Math.sqrt(va*vb);};

// ---------- HITTER ----------
const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"); const hg=hitSheet.gi;
const HM=(await all("Hitter Master","source_player_id,division,pa")).filter(r=>r.division==="D1");
for (const MINPA of [1, 50, 100]) {
  const rows=[];
  for(const h of HM){const row=hitSheet.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);const PA=g("PA");if(PA<MINPA)continue;
    const HR=g("HR"),T3=g("3B"),T2=g("2B"),Hh=g("H"),BB=g("BB"),HBP=g("HBP");const B1=Math.max(0,Hh-T2-T3-HR);
    const woba=(WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR)/PA;
    rows.push({woba,OBP:g("OBP"),SLG:g("SLG"),ISO:g("ISO"),AVG:g("AVG")});}
  const y=rows.map(r=>r.woba);
  const b=ols(rows.map(r=>[1,r.OBP,r.SLG]),y);
  const bx=ols(rows.map(r=>[1,r.OBP,r.SLG,r.ISO,r.AVG]),y);
  console.log(`HITTER (PA≥${MINPA}, n=${rows.length}):  wOBA = ${b[0].toFixed(3)} + ${b[1].toFixed(3)}·OBP + ${b[2].toFixed(3)}·SLG   R²=${r2(rows.map(r=>[1,r.OBP,r.SLG]),y,b).toFixed(4)} corr=${Math.sqrt(r2(rows.map(r=>[1,r.OBP,r.SLG]),y,b)).toFixed(4)}`);
  if(MINPA===100) console.log(`   +ISO+AVG: OBP ${bx[1].toFixed(3)} SLG ${bx[2].toFixed(3)} ISO ${bx[3].toFixed(3)} AVG ${bx[4].toFixed(3)}  R²=${r2(rows.map(r=>[1,r.OBP,r.SLG,r.ISO,r.AVG]),y,bx).toFixed(4)} (ISO/AVG redundant if ≈0)`);
}

// ---------- PITCHER ----------
const pitSheet=sheet("docs/drs-reference/Full Season Pitching Master Stats.csv"); const pg=pitSheet.gi;
const PM=(await all("Pitching Master","source_player_id,division,IP,ERA,FIP")).filter(r=>r.division==="D1"&&r.IP>0);
console.log("");
for (const MINIP of [1, 20, 40]) {
  const rows=[];
  for(const p of PM){const row=pitSheet.rows[String(p.source_player_id)];if(!row)continue;const IP=p.IP;if(IP<MINIP)continue;
    const g=k=>num(row[pg(k)]);const K=g("K"),BB=g("BB"),HBP=g("HBP"),HR=g("HR"),R=g("R"),ERA=num(p.ERA);
    if(!(ERA>0))continue;
    rows.push({ERA,K9:K*9/IP,BB9:BB*9/IP,HR9:HR*9/IP,HBP9:HBP*9/IP,RA9:R*9/IP,IP,name:(row[pg("playerFullName")]||"").trim()});}
  const y=rows.map(r=>r.ERA);
  const b3=ols(rows.map(r=>[1,r.K9,r.BB9,r.HR9]),y);
  const bH=ols(rows.map(r=>[1,r.K9,r.BB9+r.HBP9,r.HR9]),y);
  console.log(`PITCHER (IP≥${MINIP}, n=${rows.length}):`);
  console.log(`   3-pred ERA = ${b3[0].toFixed(3)} + ${b3[1].toFixed(3)}·K9 + ${b3[2].toFixed(3)}·BB9 + ${b3[3].toFixed(3)}·HR9   R²=${r2(rows.map(r=>[1,r.K9,r.BB9,r.HR9]),y,b3).toFixed(4)}`);
  console.log(`   HBP-fold ERA = ${bH[0].toFixed(3)} + ${bH[1].toFixed(3)}·K9 + ${bH[2].toFixed(3)}·(BB9+HBP9) + ${bH[3].toFixed(3)}·HR9   R²=${r2(rows.map(r=>[1,r.K9,r.BB9+r.HBP9,r.HR9]),y,bH).toFixed(4)}`);
  if(MINIP===20){
    // same-season |Δ|: FIP-hat -> RA9 (×E2T) vs actual RA9
    const dEng=rows.map(r=>{const fh=bH[0]+bH[1]*r.K9+bH[2]*(r.BB9+r.HBP9)+bH[3]*r.HR9;return Math.abs(fh*E2T-r.RA9);});
    console.log(`   same-season |FIP·E2T − actual RA9|: mean ${(dEng.reduce((s,x)=>s+x,0)/dEng.length).toFixed(3)}`);
    for(const nm of ["magdaleno","volantis","flora","urbanczyk"]){const r=rows.find(x=>x.name.toLowerCase().includes(nm));if(r){const fh=bH[0]+bH[1]*r.K9+bH[2]*(r.BB9+r.HBP9)+bH[3]*r.HR9;console.log(`     ${r.name.padEnd(22)} IP ${String(Math.round(r.IP)).padStart(3)} ERA ${r.ERA.toFixed(2)} | FIP̂ ${fh.toFixed(2)} → RA9̂ ${(fh*E2T).toFixed(2)} (actual RA9 ${r.RA9.toFixed(2)}, Δ ${(fh*E2T-r.RA9).toFixed(2)})`);}}
  }
}
