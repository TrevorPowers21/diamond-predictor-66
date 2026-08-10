/**
 * VERIFY (dry, read-only) the two flagged issues with DATA:
 *   (A) oWAR conversion: RUNS_PER_PA 0.163 vs the wRAA-scale (lgwOBA/wOBAscale) — does 0.163 compress elite bats ~2×?
 *   (B) wOBA baseline: fixture lgwOBA 0.3774 (DRS pool) vs the PA-weighted mean over ALL D1 hitters.
 * Uses the SAME sources/weights as populate_descriptive_war.mjs. Writes nothing.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;

const C = JSON.parse(readFileSync("output/descriptive_constants.json", "utf8"));
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const RPW = C.RPW;
const WT = W.woba_weights_above_out_scaled, LGWOBA_FIX = W.lgwOBA, WSCALE = W.wOBAscale, OREPL = W.offense_replacement_wins_per_600pa;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path,key="playerId"){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi(key)]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
const HM = (await all("Hitter Master", "source_player_id,division,pa")).filter(r => r.division === "D1");
const hg = hitSheet.gi;

// build per-hitter records
const recs = [];
let sumWobaPA = 0, sumMetricPA = 0, sumPA = 0, sumOBPpa = 0;
for (const h of HM) {
  const row = hitSheet.rows[String(h.source_player_id)];
  if (!row) continue;
  const g = k => num(row[hg(k)]);
  const PA = g("PA"); if (PA <= 0) continue;
  const HR=g("HR"),T3=g("3B"),T2=g("2B"),Hh=g("H"),BB=g("BB"),HBP=g("HBP");
  const B1 = Math.max(0, Hh-T2-T3-HR);
  const woba = (WT.BB*BB + WT.HBP*HBP + WT["1B"]*B1 + WT["2B"]*T2 + WT["3B"]*T3 + WT.HR*HR)/PA;
  const OBP = num(row[hg("OBP")]), SLG = num(row[hg("SLG")]);
  const metric = 0.691*OBP + 0.235*SLG;          // refined wRC+ numerator (post-CSV-fix coeffs)
  const name = (row[hg("playerFullName")] || "").trim();
  recs.push({ id:String(h.source_player_id), name, PA, woba, OBP, SLG, metric });
  sumWobaPA += woba*PA; sumMetricPA += metric*PA; sumOBPpa += OBP*PA; sumPA += PA;
}
const lgwOBA_allD1 = sumWobaPA/sumPA;             // PA-weighted mean wOBA over ALL D1
const lgMetric_allD1 = sumMetricPA/sumPA;         // the refined-wRC+ denom on all D1
const lgOBP_allD1 = sumOBPpa/sumPA;

console.log(`\n=== (B) BASELINE: PA-weighted over ${recs.length} D1 hitters (${Math.round(sumPA)} PA) ===`);
console.log(`  lgwOBA:  fixture(pool) ${LGWOBA_FIX}  vs  all-D1 ${lgwOBA_allD1.toFixed(4)}   Δ ${(lgwOBA_allD1-LGWOBA_FIX).toFixed(4)}`);
console.log(`  lgOBP:   fixture(pool) ${W.lgOBP}  vs  all-D1 ${lgOBP_allD1.toFixed(4)}`);
console.log(`  refined-wRC+ denom (0.691·OBP+0.235·SLG), all-D1 = ${lgMetric_allD1.toFixed(4)}`);
// per-hitter WAR shift from re-centering (pool -> all-D1), holding weights+scale
const shift = recs.map(r => {
  const wraa_pool  = ((r.woba - LGWOBA_FIX)/WSCALE)*r.PA;
  const wraa_allD1 = ((r.woba - lgwOBA_allD1)/WSCALE)*r.PA;
  return ((wraa_allD1 - wraa_pool)/RPW);          // change in desc_owar
});
const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
console.log(`  desc_owar shift from re-centering: mean ${mean(shift).toFixed(3)} WAR (min ${Math.min(...shift).toFixed(3)}, max ${Math.max(...shift).toFixed(3)})`);
console.log(`  → every hitter drops ~${(-mean(shift)).toFixed(2)} WAR (bigger PA = bigger drop). Split shifts toward pitchers.`);

// ---- (A) oWAR conversion on the CORRECTED all-D1 baseline ----
const RPP_HEUR = 0.163;
const RPP_CORRECT = lgwOBA_allD1 / WSCALE;         // the wRAA-scale run value per wOBA point
const REPL600 = 2.0 * RPW;
console.log(`\n=== (A) oWAR CONVERSION (RUNS_PER_PA) ===`);
console.log(`  heuristic RUNS_PER_PA = ${RPP_HEUR}   vs   correct lgwOBA/wOBAscale = ${RPP_CORRECT.toFixed(4)}   (${(RPP_CORRECT/RPP_HEUR).toFixed(2)}× miss)`);

// for each hitter: descriptive owar (truth), heuristic owar, wraa-scale owar — all on all-D1 baseline
function descOwar(r){ const wraa=((r.woba-lgwOBA_allD1)/WSCALE)*r.PA; return (wraa + (r.PA/600)*REPL600)/RPW; }
function heurOwar(r){ const wrc=r.metric/lgMetric_allD1*100; const off=(wrc-100)/100; const raa=off*r.PA*RPP_HEUR; return (raa+(r.PA/600)*REPL600)/RPW; }
function scaleOwar(r){ const wrc=r.metric/lgMetric_allD1*100; const off=(wrc-100)/100; const raa=off*r.PA*RPP_CORRECT; return (raa+(r.PA/600)*REPL600)/RPW; }
const dH = recs.map(r=>Math.abs(heurOwar(r)-descOwar(r)));
const dS = recs.map(r=>Math.abs(scaleOwar(r)-descOwar(r)));
console.log(`  mean |proj−desc| oWAR:   heuristic(0.163) ${mean(dH).toFixed(3)}   wRAA-scale ${mean(dS).toFixed(3)}`);

// spot elite bats
console.log(`\n  elite-bat spot check (desc / heuristic / wRAA-scale):`);
const elite = [...recs].sort((a,b)=>descOwar(b)-descOwar(a)).slice(0,6);
for (const r of elite) console.log(`    ${r.name.padEnd(24)} PA ${String(r.PA).padStart(3)}  wOBA ${r.woba.toFixed(3)}  desc ${descOwar(r).toFixed(2)}   heur ${heurOwar(r).toFixed(2)}   scale ${scaleOwar(r).toFixed(2)}`);
for (const nm of ["hairston"]) { const r = recs.find(x=>x.name.toLowerCase().includes(nm)); if (r) console.log(`    [${nm}] ${r.name.padEnd(20)} PA ${r.PA} wOBA ${r.woba.toFixed(3)} desc ${descOwar(r).toFixed(2)} heur ${heurOwar(r).toFixed(2)} scale ${scaleOwar(r).toFixed(2)}`); }
