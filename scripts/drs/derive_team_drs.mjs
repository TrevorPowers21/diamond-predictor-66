/**
 * WAR redesign · Step 1 — TEAM defensive dRS for the descriptive pitcher WAR (RA9 − dRS-behind).
 * B-R method: full-season team defense prorated by pitcher IP. Uses RE-CENTERED drs_floor
 * (doctrine: raw where books balance, REGRESSED where estimates predict, CENTERED where a regressed
 * estimate enters a balancing ledger — the dRS-behind fixture is a prediction input entering a
 * zero-sum ledger). Centering is INNINGS-WEIGHTED, per division.
 *   dRS_behind(pitcher) = centered_team_dRS × pitcher_IP / team_IP     (Σ over all pitchers = 0 exactly)
 * Emits scripts/drs/output/team_drs.csv and prints the team_war_snapshots storage SQL.
 *   node scripts/drs/derive_team_drs.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
// ── FIX 1 (2026-08-30): env-driven + double-keyed --prod guard. `:13` previously read the LITERAL "./.env.local",
//    so this producer could ONLY ever hit staging — which is why prod never got a derived team_drs. The bulletproof
//    checklist row D2 already called for exactly this fix ("FIX: add --prod + env guard").
//    staging: npx tsx --env-file=.env.local            scripts/drs/derive_team_drs.mjs
//    prod:    npx tsx --env-file=.env.production.local scripts/drs/derive_team_drs.mjs --prod
const envFile=(f,k)=>{try{return readFileSync(f,"utf8").split("\n").find(l=>l.startsWith(k+"="))?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g,"")??"";}catch{return"";}};
const URL_=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||envFile("./.env.local","VITE_SUPABASE_URL");
const KEY_=process.env.SUPABASE_SERVICE_ROLE_KEY||envFile("./.env.local","SUPABASE_SERVICE_ROLE_KEY");
if(!URL_||!KEY_){console.error("✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");process.exit(1);}
const IS_PROD=/trbvxuoliwrfowibatkm/.test(URL_), PROD_FLAG=process.argv.includes("--prod");
if(IS_PROD&&!PROD_FLAG){console.error("✗ URL is PROD but --prod was not passed — refusing.");process.exit(1);}
if(!IS_PROD&&PROD_FLAG){console.error("✗ --prod passed but URL is not prod — refusing.");process.exit(1);}
console.log(`[env] ${IS_PROD?"🔴 PROD":"STAGING/other"} — read-only (writes a CSV only, no DB write)`);
const sb=createClient(URL_,KEY_);

// ── FIX 2 (2026-08-30): ORDERED pagination. All three loops used a bare .range() with no .order(), and PostgREST
//    gives no stable order without ORDER BY. On prod that is ~31 pages over each Master (30,025 rows) and ~14 over
//    player_season_defense (13,454) — a dropped/duplicated page silently UNDER- or OVER-states a team's Σ drs_floor,
//    which is exactly the number this script exists to produce. Keys verified against information_schema: the
//    player_season_* tables have NO "id" column (same map as src/lib/computeNcaaAverages.ts PAGINATION_KEYS).
const ORDER_KEYS={"player_season_defense":["player_id","season","position"],"player_season_baserunning":["player_id","season"]};
const ordered=(q,t)=>(ORDER_KEYS[t]||["id"]).reduce((acc,k)=>acc.order(k,{ascending:true}),q);
async function all(t,c){let a=[];for(let f=0;;f+=1000){const{data,error}=await ordered(sb.from(t).select(c),t).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
const src2tid={},src2div={},tid2name={};
for(const t of ["Hitter Master","Pitching Master"]){let m=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select('source_player_id,TeamID,Team,division').eq("Season",2026).order("id",{ascending:true}).range(f,f+999);if(error){console.error(t,error.message);process.exit(1);}if(!data)break;m=m.concat(data);if(data.length<1000)break;}
  console.log(`  ${t}: ${m.length} rows`);
  for(const r of m){if(r.TeamID){src2tid[String(r.source_player_id)]=r.TeamID;src2div[String(r.source_player_id)]=r.division;tid2name[r.TeamID]=r.Team;}}}
const def=await all("player_season_defense","source_player_id,drs_floor");
console.log(`  player_season_defense: ${def.length} rows`);
const teamFloor={},teamDiv={};
for(const d of def){const tid=src2tid[String(d.source_player_id)]; if(!tid)continue; teamFloor[tid]=(teamFloor[tid]||0)+(d.drs_floor||0); teamDiv[tid]=src2div[String(d.source_player_id)];}
let pm=[];for(let f=0;;f+=1000){const{data,error}=await sb.from("Pitching Master").select('TeamID,IP').eq("Season",2026).order("id",{ascending:true}).range(f,f+999);if(error){console.error("Pitching Master",error.message);process.exit(1);}if(!data)break;pm=pm.concat(data);if(data.length<1000)break;}
const teamIP={}; for(const p of pm) if(p.TeamID) teamIP[p.TeamID]=(teamIP[p.TeamID]||0)+(p.IP||0);
// TeamID(uuid) -> source_team_id (team_war_snapshots key) via Teams Table
const teams=await all("Teams Table","id,source_id");
const tid2srcTeam={}; for(const t of teams) tid2srcTeam[t.id]=t.source_id;
// innings-weighted centering per division
const byDiv={};
for(const tid of Object.keys(teamFloor)){const dv=teamDiv[tid]||"?",ip=teamIP[tid]||0; if(ip<=0)continue; (byDiv[dv]=byDiv[dv]||{f:0,ip:0,t:[]}); byDiv[dv].f+=teamFloor[tid]; byDiv[dv].ip+=ip; byDiv[dv].t.push(tid);}
const out=[["team_id","source_team_id","team","division","team_drs","raw_floor","team_def_ip"]];
for(const dv of Object.keys(byDiv)){const rate=byDiv[dv].f/byDiv[dv].ip; let chk=0;
  for(const tid of byDiv[dv].t){const c=teamFloor[tid]-rate*teamIP[tid]; chk+=c;
    out.push([tid,tid2srcTeam[tid]??"",tid2name[tid]||"",dv,c.toFixed(3),teamFloor[tid].toFixed(3),teamIP[tid].toFixed(1)]);}
  console.log(`div ${dv}: ${byDiv[dv].t.length} teams | Σ centered ${chk.toFixed(4)} (must be 0)`);}
mkdirSync("scripts/drs/output",{recursive:true});
writeFileSync("scripts/drs/output/team_drs.csv", out.map(r=>r.join(",")).join("\n"));
const withSrc=out.slice(1).filter(r=>r[1]!=="").length;
console.log(`wrote scripts/drs/output/team_drs.csv (${out.length-1} teams; ${withSrc} mapped to source_team_id)`);
