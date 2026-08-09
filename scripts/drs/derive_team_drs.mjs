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
const env=Object.fromEntries(readFileSync("./.env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const sb=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
async function all(t,c){let a=[];for(let f=0;;f+=1000){const{data,error}=await sb.from(t).select(c).range(f,f+999);if(error){console.error(error.message);process.exit(1);}a=a.concat(data);if(data.length<1000)break;}return a;}
const src2tid={},src2div={},tid2name={};
for(const t of ["Hitter Master","Pitching Master"]){let m=[];for(let f=0;;f+=1000){const{data}=await sb.from(t).select('source_player_id,TeamID,Team,division').eq("Season",2026).range(f,f+999);if(!data)break;m=m.concat(data);if(data.length<1000)break;}
  for(const r of m){if(r.TeamID){src2tid[String(r.source_player_id)]=r.TeamID;src2div[String(r.source_player_id)]=r.division;tid2name[r.TeamID]=r.Team;}}}
const def=await all("player_season_defense","source_player_id,drs_floor");
const teamFloor={},teamDiv={};
for(const d of def){const tid=src2tid[String(d.source_player_id)]; if(!tid)continue; teamFloor[tid]=(teamFloor[tid]||0)+(d.drs_floor||0); teamDiv[tid]=src2div[String(d.source_player_id)];}
let pm=[];for(let f=0;;f+=1000){const{data}=await sb.from("Pitching Master").select('TeamID,IP').eq("Season",2026).range(f,f+999);if(!data)break;pm=pm.concat(data);if(data.length<1000)break;}
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
