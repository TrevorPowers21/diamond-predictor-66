/**
 * Does the pitcher peak-vs-average gap match the SPREAD of actual offensive production?
 * A win is a win: hitter value spread (runs created above avg -> WAR) and pitcher value spread
 * (runs prevented above avg -> WAR) should be CONSISTENT, tied by RPW. In a friendly-offense league
 * the environment is priced by RPW (13.1 vs MLB ~10). Test: compare SD + peak on both sides, and
 * measure the emergent hitter/pitcher split + the replacement contribution (Step-5 sensitivity).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const L = JSON.parse(readFileSync("output/ncaa_league_averages_2026.json", "utf8"));
const RPW = L.war_constants.RPW.value, lgRA9 = L.pitching.lgRA9.mean, replRA9 = L.war_constants.replacement_RA9.value;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
function ms(a){const v=a.filter(Number.isFinite);const n=v.length,m=v.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/n);return{n,m,sd,max:Math.max(...v)};}

// HITTERS (PA>=100): runs above avg = wraa; value = desc_owar (offense only, apples-to-apples vs pWAR)
const HM=(await all("Hitter Master","division,pa,wraa,desc_owar,total_desc_war")).filter(r=>r.division==="D1"&&(r.pa||0)>=100);
const hRAA=ms(HM.map(r=>num(r.wraa))), hOW=ms(HM.map(r=>num(r.desc_owar)));
// PITCHERS (IP>=30): runs above avg = (lgRA9 - desc_ra9)*IP/9 ; value = desc_pwar
const PM=(await all("Pitching Master","division,IP,desc_ra9,desc_pwar")).filter(r=>r.division==="D1"&&(r.IP||0)>=30&&r.desc_pwar!=null);
const pRAA=ms(PM.map(r=>(lgRA9-num(r.desc_ra9))*num(r.IP)/9)), pPW=ms(PM.map(r=>num(r.desc_pwar)));

console.log("VALUE SPREAD — hitter offense vs pitcher (qualified):");
console.log(`  runs above avg:  hitter SD ${hRAA.sd.toFixed(1)} peak ${hRAA.max.toFixed(0)}   |  pitcher SD ${pRAA.sd.toFixed(1)} peak ${pRAA.max.toFixed(0)}`);
console.log(`  WAR:             oWAR  SD ${hOW.sd.toFixed(2)} peak ${hOW.max.toFixed(2)} (${((hOW.max-hOW.m)/hOW.sd).toFixed(1)}σ)   |  pWAR SD ${pPW.sd.toFixed(2)} peak ${pPW.max.toFixed(2)} (${((pPW.max-pPW.m)/pPW.sd).toFixed(1)}σ)`);
console.log(`  => if the WAR SDs match, the run->win conversion (RPW ${RPW}) has tied the two sides on ONE scale.`);

// friendly-environment sensitivity: what pWAR SD would be at other RPW (shows the environment IS priced by RPW)
console.log(`\n  RPW sensitivity (pitcher peak pWAR):  @RPW 13.1 = ${pPW.max.toFixed(2)}   @10 (MLB) = ${(pPW.max*13.1/10).toFixed(2)}   @14 = ${(pPW.max*13.1/14).toFixed(2)}`);
console.log(`  (higher RPW in a friendlier-offense league TIGHTENS the gap — the environment is already in the divisor.)`);

// emergent split + replacement contribution (Step-5)
const sumH=HM.reduce((s,r)=>s+num(r.total_desc_war),0), sumP=PM.reduce((s,r)=>s+num(r.desc_pwar),0);
// approx replacement share of each side's WAR
const hRepl=HM.reduce((s,r)=>s+(num(r.pa)/600)*2.0,0), pRepl=PM.reduce((s,r)=>s+((replRA9-lgRA9)*num(r.IP)/9)/RPW,0);
console.log(`\nEMERGENT SPLIT (Σ WAR above replacement, qualified):  hitters ${sumH.toFixed(0)}  pitchers ${sumP.toFixed(0)}  ->  ${(100*sumH/(sumH+sumP)).toFixed(0)}/${(100*sumP/(sumH+sumP)).toFixed(0)} (pos/pit). MLB ~57/43.`);
console.log(`  replacement CONTRIBUTION to WAR:  hitter Σ ${hRepl.toFixed(0)} (${(hRepl/sumH*100).toFixed(0)}% of hitter WAR from the 2.0/600 floor)  |  pitcher Σ ${pRepl.toFixed(0)} (${(pRepl/sumP*100).toFixed(0)}% from the 8.83 floor)`);
console.log(`  (Step-5: if these two floors imply different generosity, that is the split lever — check the % are comparable.)`);
