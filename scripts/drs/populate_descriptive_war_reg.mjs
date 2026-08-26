/**
 * Step 2 — populate REGULAR-SEASON descriptive WAR (≤ 2026-05-18) onto the Masters (STAGING).
 * Mirrors populate_descriptive_war.mjs but on regular-season inputs. The FULL-season desc_* columns stay
 * as the historical headline; these desc_*_reg columns feed the projection GAP + team snapshots/analytics.
 *   HITTER:  reg counting (hitter_accrued.csv reg_*) → reg wOBA → wraa_reg → desc_owar_reg
 *            d_war_reg = Σ reg drs_floor(pos≠P)/RPW ;  bsr_war_reg = wsb_runs_reg/RPW
 *   PITCHER: reg_IP/reg_R/reg_FIP (pitcher_line.csv; reg_R accrued directly — total runs w/ inherited-runner
 *            attribution, earned+unearned, same engine as ER); reg_drs_behind = stored drs_behind × (reg_IP/full_IP);
 *            desc_ra9_reg = 0.5·(reg_RA9 + reg_drs_behind_per9) + 0.5·(reg_FIP·E2T)
 *   node scripts/drs/populate_descriptive_war_reg.mjs [--commit]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { assertCentering } from "./_fixture_guard.mjs";
const COMMIT = process.argv.includes("--commit");
const IS_PROD = process.argv.includes("--prod");
const ENV_FILE = IS_PROD ? ".env.production.local" : ".env.local";
const env = Object.fromEntries(readFileSync(ENV_FILE,"utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const _url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
if (/trbvxuoliwrfowibatkm/.test(_url) && !IS_PROD) { console.error("✗ URL looks like PROD but --prod not passed. Refusing."); process.exit(1); }
if (IS_PROD && !/trbvxuoliwrfowibatkm/.test(_url)) { console.error("✗ --prod passed but URL is not prod. Refusing."); process.exit(1); }
console.log(`target: ${IS_PROD ? "🔴 PROD" : "STAGING"}${COMMIT ? "" : " [dry-run — pass --commit to write]"}`);
const sb = createClient(_url, env.SUPABASE_SERVICE_ROLE_KEY);
const C = JSON.parse(readFileSync("output/descriptive_constants.json","utf8"));
const W = JSON.parse(readFileSync("output/woba_weights.json","utf8"));
assertCentering("all-D1", { name:"descriptive_constants", meta:C._meta }, { name:"woba_weights", meta:W._meta });
const RPW=C.RPW, E2T=C.E2T, REPL_RA9=C.replacement_RA9;
const WT=W.woba_weights_above_out_scaled, LGWOBA=W.lgwOBA, WSCALE=W.wOBAscale, OREPL=W.offense_replacement_wins_per_600pa;

const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:0;};
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}else{if(ch==='"')q=true;else if(ch===','){out.push(cur);cur="";}else cur+=ch;}}out.push(cur);return out;}
function sheet(path,key="source_player_id"){const t=readFileSync(path,"utf8").split("\n");const H=parseLine(t[0]);const gi=k=>H.indexOf(k);const m={};for(let i=1;i<t.length;i++){if(!t[i])continue;const c=parseLine(t[i]);const id=(c[gi(key)]||"").trim();if(id)m[id]=c;}return{rows:m,gi};}
async function all(t,cols){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(cols).eq("Season",2026).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
async function allNoSeason(t,cols,sc){let a=[];for(let f=0;;f+=1000){let q=sb.from(t).select(cols).range(f,f+999);if(sc)q=q.eq(sc,2026);const{data,error}=await q;if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
const r3=x=>Number.isFinite(x)?Math.round(x*1000)/1000:null, r4=x=>Number.isFinite(x)?Math.round(x*10000)/10000:null;

// ── sources ──────────────────────────────────────────────────────────────────
const hitAcc = sheet("scripts/drs/output/hitter_accrued.csv");     // reg_* counting (Step 2 accrual)
const pitLine = sheet("scripts/drs/output/pitcher_line.csv");      // reg_IP/reg_R/reg_FIP (reg_R accrued directly)
const HM = (await all("Hitter Master","source_player_id,division,pa,regular_season_pa")).filter(r=>r.division==="D1");
const PM = (await all("Pitching Master","source_player_id,division,IP,regular_season_ip,drs_behind,desc_pwar")).filter(r=>r.division==="D1"&&r.IP>0);

// reg dRS (drs_floor, pos≠P) + reg wSB, keyed by source_player_id
const defReg = sheet("scripts/drs/output/player_season_defense_regseason.csv","source_player_id");
const dwarReg={}; for(const id in defReg.rows){const c=defReg.rows[id];const pos=(c[defReg.gi("position")]||"").trim();if(pos==="P")continue;dwarReg[id]=(dwarReg[id]||0)+num(c[defReg.gi("drs_floor")]);}
const bsrReg = sheet("scripts/drs/output/player_season_baserunning.csv","playerId");
const bwarReg={}; for(const id in bsrReg.rows){bwarReg[id]=num(bsrReg.rows[id][bsrReg.gi("wsb_runs_reg")]);}

// ── HITTERS ──────────────────────────────────────────────────────────────────
const hitUpd=[]; let hMiss=0;
const hg=hitAcc.gi;
for(const h of HM){
  const row=hitAcc.rows[String(h.source_player_id)];
  if(!row){hMiss++;continue;}
  const g=k=>num(row[hg(k)]);
  const PA=g("reg_PA"); if(PA<=0) continue;
  const HR=g("reg_HR"),T3=g("reg_3B"),T2=g("reg_2B"),Hh=g("reg_H"),BB=g("reg_BB"),HBP=g("reg_HBP");
  const B1=Math.max(0,Hh-T2-T3-HR);
  const woba=(WT.BB*BB+WT.HBP*HBP+WT["1B"]*B1+WT["2B"]*T2+WT["3B"]*T3+WT.HR*HR)/PA;
  const wraa=((woba-LGWOBA)/WSCALE)*PA;
  const desc_owar=wraa/RPW+(PA/600)*OREPL;
  const d_war=(dwarReg[String(h.source_player_id)]||0)/RPW;
  const bsr_war=(bwarReg[String(h.source_player_id)]||0)/RPW;
  hitUpd.push({source_player_id:h.source_player_id, woba_reg:r4(woba), wraa_reg:r3(wraa), desc_owar_reg:r3(desc_owar), d_war_reg:r3(d_war), bsr_war_reg:r3(bsr_war), total_desc_war_reg:r3(desc_owar+d_war+bsr_war)});
}

// ── PITCHERS ─────────────────────────────────────────────────────────────────
const pitUpd=[]; let pMiss=0;
const pg=pitLine.gi;
for(const p of PM){
  const row=pitLine.rows[String(p.source_player_id)];
  if(!row){pMiss++;continue;}
  const g=k=>num(row[pg(k)]);
  const regIP=g("reg_IP"); if(regIP<=0) continue;
  const regFIP=g("reg_FIP");
  const regR=g("reg_R");                 // total runs, accrued directly (earned+unearned, inherited-runner attribution)
  const regRA9=regR*9/regIP;
  const fullIP=p.IP, storedBehind=num(p.drs_behind);
  const regBehindRuns=fullIP>0?storedBehind*(regIP/fullIP):0;      // prorate stored drs_behind by IP
  const regBehindPer9=regBehindRuns*9/regIP;
  const desc_fip_ra9=(regFIP||0)*E2T;
  const desc_ra9=0.5*(regRA9+regBehindPer9)+0.5*desc_fip_ra9;
  const desc_pwar=(REPL_RA9-desc_ra9)*regIP/9/RPW;
  pitUpd.push({source_player_id:p.source_player_id, desc_ra9_reg:r3(desc_ra9), desc_fip_ra9_reg:r3(desc_fip_ra9), drs_behind_reg:r3(regBehindRuns), desc_pwar_reg:r3(desc_pwar), total_desc_war_reg:r3(desc_pwar)});
}

const stat=(a,k)=>{const v=a.map(r=>r[k]).filter(x=>x!=null).sort((x,y)=>x-y);return{n:v.length,min:v[0],p50:v[Math.floor(v.length/2)],max:v[v.length-1],mean:r3(v.reduce((s,x)=>s+x,0)/v.length)};};
console.log(`\nHITTERS D1 ${HM.length} | computed ${hitUpd.length} | acc-miss ${hMiss}`);
console.log("  desc_owar_reg",stat(hitUpd,"desc_owar_reg"),"\n  total_desc_war_reg",stat(hitUpd,"total_desc_war_reg"));
console.log(`PITCHERS D1 ${PM.length} | computed ${pitUpd.length} | line-miss ${pMiss}`);
console.log("  desc_pwar_reg",stat(pitUpd,"desc_pwar_reg"),"\n  desc_ra9_reg",stat(pitUpd,"desc_ra9_reg"));

if(!COMMIT){console.log("\n(dry run — pass --commit to write; needs the desc_*_reg columns ALTERed first)");process.exit(0);}
async function writeAll(table,updates){let done=0;const POOL=24;for(let i=0;i<updates.length;i+=POOL){await Promise.all(updates.slice(i,i+POOL).map(async u=>{const{source_player_id,...cols}=u;const{error}=await sb.from(table).update(cols).eq("source_player_id",source_player_id).eq("Season",2026);if(error)console.error(table,source_player_id,error.message);}));done+=Math.min(POOL,updates.length-i);if(done%2400===0||done===updates.length)process.stdout.write(`\r  ${table}: ${done}/${updates.length}`);}console.log("");}
console.log("\nwriting…");
await writeAll("Hitter Master",hitUpd);
await writeAll("Pitching Master",pitUpd);
console.log("done.");
