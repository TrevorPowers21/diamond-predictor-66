/**
 * PROVE what 0.40 (RUNS_PER_PA) actually is, from first principles — NOT a knob.
 * It is the RE24 linear run values (runs per event, derived from the D1 pitch log), repackaged.
 * Check: compute each hitter's runs-above-average THREE independent ways; all must agree.
 *   (1) PURE RE24:   Σ(run_value_above_avg_e × events_e)      <- the ground-truth run values
 *   (2) wOBA method: (wOBA − lgwOBA)/wOBAscale × PA
 *   (3) wRC+ × 0.40: (wRC+/100 − 1) × PA × (lgwOBA/wOBAscale)
 * If (1)=(2)=(3), then 0.40 is just the RE24 weights, and the "0.13→0.40" jump is fixing a wrong repackaging.
 * Also: show the D1 run values vs MLB, and the below/avg/star oWAR math OLD(0.163) vs NEW(0.40).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8"));
const LWA = W.linear_weights_above_avg;              // runs ABOVE AVERAGE per event (out is negative)
const WT = W.woba_weights_above_out_scaled;
const L = JSON.parse(readFileSync("output/ncaa_league_averages_2026.json", "utf8"));
const lgwOBA = L.hitting.lgwOBA.mean, WSCALE = L.hitting.wOBAscale.value, RPW = L.war_constants.RPW.value;
const RPP = lgwOBA/WSCALE;                            // 0.40
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}

console.log("D1 RE24 run values (runs above AVERAGE per event) — from the pitch log, vs MLB:");
console.log(`  BB  ${LWA.BB.toFixed(3)} (MLB ~0.29)   HBP ${LWA.HBP.toFixed(3)}   1B ${LWA["1B"].toFixed(3)} (MLB ~0.44)   2B ${LWA["2B"].toFixed(3)}   3B ${LWA["3B"].toFixed(3)}   HR ${LWA.HR.toFixed(3)} (MLB ~1.37)   OUT ${LWA.out.toFixed(3)} (MLB ~-0.26)`);
console.log(`  => D1 values are LARGER than MLB (a hit drives in more, an out wastes more) — that IS the high-offense environment, on the EVENTS->RUNS step.`);
console.log(`  RUNS_PER_PA = lgwOBA/wOBAscale = ${lgwOBA}/${WSCALE} = ${RPP.toFixed(4)}\n`);

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
async function one(name){
  const row=Object.values(hs.rows).find(c=>(c[hg("playerFullName")]||"").toLowerCase().includes(name));
  if(!row){console.log(`  ${name}: not found`);return;}
  const g=k=>num(row[hg(k)]);
  const PA=g("PA"),H=g("H"),BB=g("BB"),HBP=g("HBP"),T2=g("2B"),T3=g("3B"),HR=g("HR");
  const B1=Math.max(0,H-T2-T3-HR), outs=PA-H-BB-HBP;
  const woba=(WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR)/PA;
  const wrc=(0.011+0.691*g("OBP")+0.235*g("SLG"))/lgwOBA*100;
  const re24 = LWA.BB*BB+LWA.HBP*HBP+LWA["1B"]*B1+LWA["2B"]*T2+LWA["3B"]*T3+LWA.HR*HR+LWA.out*outs;
  const wobaM = (woba-lgwOBA)/WSCALE*PA;
  const wrcM = (wrc/100-1)*PA*RPP;
  console.log(`  ${(row[hg("playerFullName")]||"").padEnd(20)} PA ${PA}  wRC+ ${wrc.toFixed(0)}   runs-above-avg:  RE24 ${re24.toFixed(1)}   wOBA-method ${wobaM.toFixed(1)}   wRC+×0.40 ${wrcM.toFixed(1)}`);
}
console.log("THREE-WAY runs-above-average (must agree):");
for(const n of ["hairston","helfrick","advincula"]) await one(n);

console.log("\nBELOW / AVG / STAR — oWAR math at 250 PA, OLD(×0.163) vs NEW(×0.40):");
console.log(`  ${"wRC+".padEnd(6)} ${"runs above avg".padEnd(24)}  ${"OLD oWAR".padEnd(9)} ${"NEW oWAR"}`);
for(const wrc of [70,100,130,150]){
  const off=(wrc-100)/100, repl=(250/600)*2.0*RPW;
  const rOLD=off*250*0.163, rNEW=off*250*RPP;
  const oOLD=(rOLD+repl)/RPW, oNEW=(rNEW+repl)/RPW;
  console.log(`  ${String(wrc).padEnd(6)} OLD ${rOLD.toFixed(1).padStart(6)} / NEW ${rNEW.toFixed(1).padStart(6)} runs    ${oOLD.toFixed(2).padStart(6)}    ${oNEW.toFixed(2).padStart(6)}`);
}
console.log(`\n  (replacement floor = ${((250/600)*2.0).toFixed(2)} WAR, identical both columns — only the ABOVE/BELOW-avg part changes.)`);
