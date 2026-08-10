import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const NAME = (process.argv[2] || "helfrick").toLowerCase();
const L = JSON.parse(readFileSync("output/ncaa_league_averages_2026.json", "utf8"));
const W = JSON.parse(readFileSync("output/woba_weights.json", "utf8")); const WT = W.woba_weights_above_out_scaled;
const RPW = L.war_constants.RPW.value, lgwOBA = L.hitting.lgwOBA.mean, WSCALE = L.hitting.wOBAscale.value, OREPL = L.war_constants.hitter_replacement_wins_per_600pa.value;
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const rows=[];for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);rows.push(c);}return{rows,gi,H};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}

const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const hit=hs.rows.find(c=>(c[hg("playerFullName")]||"").toLowerCase().includes(NAME));
if(!hit){console.log(`no hitter matching "${NAME}"`);process.exit(0);}
const g=k=>num(hit[hg(k)]);
const spid=(hit[hg("playerId")]||"").trim();
const HM=(await all("Hitter Master","source_player_id,division,pa,woba,wraa,desc_owar,d_war,bsr_war,total_desc_war")).find(r=>String(r.source_player_id)===spid);

const PA=g("PA"),OBP=g("OBP"),SLG=g("SLG"),AVG=g("AVG");
const HR=g("HR"),T3=g("3B"),T2=g("2B"),Hh=g("H"),BB=g("BB"),HBP=g("HBP");const B1=Math.max(0,Hh-T2-T3-HR);
const woba=(WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR)/PA;
const estWoba=0.011+0.691*OBP+0.235*SLG;
const wrc=estWoba/lgwOBA*100;
const off=(wrc-100)/100;
const repl=(PA/600)*(OREPL*RPW);
const oOLD=(off*PA*0.163 + repl)/RPW;      // current (wrong) conversion
const oNEW=(off*PA*(lgwOBA/WSCALE) + repl)/RPW;  // fixed conversion (0.3994)
const oTRUE=(((woba-lgwOBA)/WSCALE)*PA + repl)/RPW; // straight from true wОBA (what desc_owar is)

console.log(`\n${hit[hg("playerFullName")]}  (${hit[hg("newestTeamAbbrevName")]||""})   PA ${PA}`);
console.log(`  slash: AVG ${AVG.toFixed(3)} OBP ${OBP.toFixed(3)} SLG ${SLG.toFixed(3)}   wOBA ${woba.toFixed(3)} (lg ${lgwOBA})   wRC+ ${wrc.toFixed(0)}`);
console.log(`\n  STORED descriptive (already on the correct scale):`);
console.log(`    desc_oWAR ${HM?.desc_owar}   d_war ${HM?.d_war}  bsr_war ${HM?.bsr_war}   TOTAL desc WAR ${HM?.total_desc_war}`);
console.log(`\n  oWAR from his line, three ways:`);
console.log(`    OLD conversion (×0.163, current code) = ${oOLD.toFixed(2)}`);
console.log(`    NEW conversion (×0.3994, the fix)      = ${oNEW.toFixed(2)}`);
console.log(`    straight from true wOBA (= desc_oWAR)  = ${oTRUE.toFixed(2)}`);
console.log(`\n  => the NEW conversion should ≈ desc_oWAR ${HM?.desc_owar}. The OLD one is the outlier (compressed).`);
