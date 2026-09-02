import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const N = parseInt(process.argv[2] || "25", 10);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HM=(await all("Hitter Master","source_player_id,division,pa,desc_owar,d_war,bsr_war,total_desc_war")).filter(r=>r.division==="D1"&&r.total_desc_war!=null);
HM.sort((a,b)=>b.total_desc_war-a.total_desc_war);

const meta=r=>{const row=hs.rows[String(r.source_player_id)];if(!row)return{name:"?",team:"",pos:"",slash:""};const g=k=>num(row[hg(k)]);return{name:(row[hg("playerFullName")]||"?").trim(),team:(row[hg("newestTeamAbbrevName")]||"").trim(),pos:(row[hg("Position")]??row[hg("position")]??"")+"",slash:`${g("AVG").toFixed(3)}/${g("OBP").toFixed(3)}/${g("SLG").toFixed(3)}`,pa:g("PA")};};

console.log(`\nTOP ${N} — POSITION-PLAYER total WAR (descriptive / last season, D1)\n`);
console.log(`  #  ${"Player".padEnd(22)} ${"Tm".padEnd(4)} ${"PA".padStart(4)}  ${"slash".padEnd(19)}  oWAR  dWAR  bsr   TOTAL`);
HM.slice(0,N).forEach((r,i)=>{const m=meta(r);console.log(`  ${String(i+1).padStart(2)} ${m.name.padEnd(22)} ${m.team.padEnd(4)} ${String(m.pa).padStart(4)}  ${m.slash.padEnd(19)}  ${r.desc_owar.toFixed(2).padStart(5)} ${r.d_war.toFixed(2).padStart(5)} ${r.bsr_war.toFixed(2).padStart(5)}  ${r.total_desc_war.toFixed(2).padStart(5)}`);});
