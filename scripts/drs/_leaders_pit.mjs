import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const N = parseInt(process.argv[2] || "20", 10);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

const ps=sheet("docs/drs-reference/Full Season Pitching Master Stats.csv"),pg=ps.gi;
const PM=(await all("Pitching Master","source_player_id,division,IP,ERA,FIP,desc_ra9,drs_behind,desc_pwar,total_desc_war")).filter(r=>r.division==="D1"&&r.desc_pwar!=null);
PM.sort((a,b)=>b.desc_pwar-a.desc_pwar);
const meta=r=>{const row=ps.rows[String(r.source_player_id)];if(!row)return{name:"?",team:""};return{name:(row[pg("playerFullName")]||"?").trim(),team:(row[pg("newestTeamAbbrevName")]||"").trim()};};
console.log(`\nTOP ${N} — PITCHER WAR (descriptive / last season, D1)\n`);
console.log(`  #  ${"Player".padEnd(22)} ${"Tm".padEnd(5)} ${"IP".padStart(5)}  ${"ERA".padStart(5)} ${"FIP".padStart(5)}  ${"descRA9".padStart(7)} ${"drsBhd".padStart(6)}  pWAR`);
PM.slice(0,N).forEach((r,i)=>{const m=meta(r);console.log(`  ${String(i+1).padStart(2)} ${m.name.padEnd(22)} ${m.team.padEnd(5)} ${num(r.IP).toFixed(1).padStart(5)}  ${num(r.ERA).toFixed(2).padStart(5)} ${num(r.FIP).toFixed(2).padStart(5)}  ${num(r.desc_ra9).toFixed(2).padStart(7)} ${num(r.drs_behind).toFixed(2).padStart(6)}  ${num(r.desc_pwar).toFixed(2).padStart(5)}`);});
// distribution
const w=PM.map(r=>num(r.desc_pwar)).sort((a,b)=>a-b);const mean=w.reduce((s,x)=>s+x,0)/w.length;
console.log(`\n  n=${w.length}  mean ${mean.toFixed(2)}  max ${w[w.length-1].toFixed(2)}  p99 ${w[Math.floor(w.length*0.99)].toFixed(2)}  p90 ${w[Math.floor(w.length*0.90)].toFixed(2)}`);
