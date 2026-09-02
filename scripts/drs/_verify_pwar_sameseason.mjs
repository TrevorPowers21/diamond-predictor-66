/**
 * The REAL same-season pitcher test (the "0.30" figure), in WAR units, on corrected data:
 *   proj_pwar  = (replRA9 − FIP̂·E2T)·IP/9/RPW      (FIP̂ = the locked D1-FIP regression)
 *   desc_pwar  = stored on Pitching Master (post-CSV-fix, 50% RA9-based + 50% FIP-based)
 *   compare mean |proj_pwar − desc_pwar|.  Also the pRV+ blend, if still stored, for the 0.59 baseline.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;
const C = JSON.parse(readFileSync("output/descriptive_constants.json", "utf8"));
const RPW = C.RPW, E2T = C.E2T, REPL = C.replacement_RA9;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

// LOCKED D1-FIP (HBP-folded)
const FIP = (K9,BB9,HBP9,HR9) => 3.10 - 0.231*K9 + 0.509*(BB9+HBP9) + 1.486*HR9;

const pitSheet=sheet("docs/drs-reference/Full Season Pitching Master Stats.csv"); const pg=pitSheet.gi;
const PM=(await all("Pitching Master","source_player_id,division,IP,ERA,FIP,desc_pwar,desc_ra9,desc_fip_ra9")).filter(r=>r.division==="D1"&&r.IP>0);

for (const MINIP of [20, 30, 40]) {
  const rows=[];
  for(const p of PM){const row=pitSheet.rows[String(p.source_player_id)];if(!row)continue;const IP=p.IP;if(IP<MINIP)continue;if(p.desc_pwar==null)continue;
    const g=k=>num(row[pg(k)]);const K9=g("K")*9/IP,BB9=g("BB")*9/IP,HBP9=g("HBP")*9/IP,HR9=g("HR")*9/IP;
    const fh=FIP(K9,BB9,HBP9,HR9);const projRA9=fh*E2T;
    const proj_pwar=(REPL-projRA9)*IP/9/RPW;
    rows.push({name:(row[pg("playerFullName")]||"").trim(),IP,ERA:num(p.ERA),proj_pwar,desc_pwar:p.desc_pwar,d:Math.abs(proj_pwar-p.desc_pwar)});}
  const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
  console.log(`IP≥${MINIP} n=${rows.length}:  mean |proj_pwar − desc_pwar| = ${mean(rows.map(r=>r.d)).toFixed(3)} WAR   (locked target ≈0.30 vs blend 0.59)`);
  if(MINIP===30){
    for(const nm of ["magdaleno","volantis","flora","urbanczyk"]){const r=rows.find(x=>x.name.toLowerCase().includes(nm));if(r)console.log(`   ${r.name.padEnd(22)} IP ${String(Math.round(r.IP)).padStart(3)} | proj_pwar ${r.proj_pwar.toFixed(2)}  desc_pwar ${r.desc_pwar.toFixed(2)}  Δ ${(r.proj_pwar-r.desc_pwar).toFixed(2)}`);}
  }
}
