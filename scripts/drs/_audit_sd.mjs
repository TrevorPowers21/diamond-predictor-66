/**
 * AUDIT (read-only) — mean + SD (spread) of every NCAA D1 metric + WAR output on corrected data.
 * SD matters: it drives z-score metrics (Stuff+, power ratings), the wRC+/pRV+ tail-compression
 * diagnosis, and is a data sanity check. Reported at QUALIFIED thresholds (PA>=100 / IP>=30) so
 * tiny-sample noise doesn't inflate the spread. Population SD (÷N).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = 2026;
const L = JSON.parse(readFileSync("output/ncaa_league_averages_2026.json", "utf8"));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi("playerId")]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",SEASON).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
function ms(arr){const v=arr.filter(Number.isFinite);const n=v.length;const m=v.reduce((s,x)=>s+x,0)/n;const sd=Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/n);return{n,m,sd,max:Math.max(...v),min:Math.min(...v)};}
const line=(lbl,o,d=3)=>console.log(`  ${lbl.padEnd(16)} mean ${o.m.toFixed(d)}  SD ${o.sd.toFixed(d)}  [${o.min.toFixed(d)} … ${o.max.toFixed(d)}]  maxZ ${((o.max-o.m)/o.sd).toFixed(2)}`);

// ---------- HITTERS (PA>=100) ----------
const hs=sheet("docs/drs-reference/Full Season Hitting Master Stats.csv"),hg=hs.gi;
const HM=(await all("Hitter Master","source_player_id,division,pa,woba,wraa,desc_owar,total_desc_war")).filter(r=>r.division==="D1"&&(r.pa||0)>=100);
const H={AVG:[],OBP:[],SLG:[],ISO:[],wOBA:[],wRCplus:[],wraa:[],desc_owar:[],total:[]};
for(const h of HM){const row=hs.rows[String(h.source_player_id)];if(!row)continue;const g=k=>num(row[hg(k)]);
  H.AVG.push(g("AVG"));H.OBP.push(g("OBP"));H.SLG.push(g("SLG"));H.ISO.push(g("ISO"));
  const est=0.011+0.691*g("OBP")+0.235*g("SLG");H.wRCplus.push(est/L.hitting.lgwOBA*100);
  if(h.woba!=null)H.wOBA.push(h.woba); if(h.wraa!=null)H.wraa.push(h.wraa);
  if(h.desc_owar!=null)H.desc_owar.push(h.desc_owar); if(h.total_desc_war!=null)H.total.push(h.total_desc_war);}
console.log(`=== HITTERS (PA>=100, n=${HM.length}) ===`);
line("AVG",ms(H.AVG));line("OBP",ms(H.OBP));line("SLG",ms(H.SLG));line("ISO",ms(H.ISO));
line("wOBA",ms(H.wOBA),4);line("wRC+ (idx)",ms(H.wRCplus),1);
line("wRAA (runs)",ms(H.wraa),2);line("desc_oWAR",ms(H.desc_owar),2);line("total_desc_WAR",ms(H.total),2);

// ---------- PITCHERS (IP>=30) ----------
const ps=sheet("docs/drs-reference/Full Season Pitching Master Stats.csv"),pg=ps.gi;
const PM=(await all("Pitching Master","source_player_id,division,IP,ERA,FIP,desc_ra9,desc_pwar,total_desc_war")).filter(r=>r.division==="D1"&&(r.IP||0)>=30);
const P={ERA:[],FIP:[],K9:[],BB9:[],HR9:[],HBP9:[],RA9:[],fipQual:[],desc_ra9:[],desc_pwar:[]};
for(const p of PM){const row=ps.rows[String(p.source_player_id)];if(!row)continue;const g=k=>num(row[pg(k)]);const IP=p.IP;
  const K9=g("K")*9/IP,BB9=g("BB")*9/IP,HR9=g("HR")*9/IP,HBP9=g("HBP")*9/IP;
  P.ERA.push(num(p.ERA));if(p.FIP!=null)P.FIP.push(p.FIP);P.K9.push(K9);P.BB9.push(BB9);P.HR9.push(HR9);P.HBP9.push(HBP9);
  P.RA9.push(g("R")*9/IP);
  P.fipQual.push(3.10-0.231*K9+0.509*(BB9+HBP9)+1.486*HR9);   // D1-FIP quality metric
  if(p.desc_ra9!=null)P.desc_ra9.push(p.desc_ra9); if(p.desc_pwar!=null)P.desc_pwar.push(p.desc_pwar);}
console.log(`\n=== PITCHERS (IP>=30, n=${PM.length}) ===`);
line("ERA",ms(P.ERA));line("FIP(master)",ms(P.FIP));line("D1-FIP(qual)",ms(P.fipQual));
line("K9",ms(P.K9));line("BB9",ms(P.BB9));line("HR9",ms(P.HR9));line("HBP9",ms(P.HBP9));
line("RA9",ms(P.RA9));line("desc_ra9",ms(P.desc_ra9));line("desc_pWAR",ms(P.desc_pwar),2);

// tail-compression re-check: best pitcher (lowest D1-FIP) vs best hitter (highest wRC+), in SD-above-mean
const wrc=ms(H.wRCplus), fq=ms(P.fipQual);
console.log(`\nTAIL CHECK  best hitter wRC+ maxZ ${((wrc.max-wrc.m)/wrc.sd).toFixed(2)}  |  best pitcher D1-FIP minZ ${((fq.m-fq.min)/fq.sd).toFixed(2)}  (symmetric quality spread if ~equal)`);
