// Committed producer for the OPR + park + canonical HTP conference-stats fields
// (2026-08-21). Folds into the unified edge-fn conf-stats-derive step. D1 clean 30.
//   - run_env_factor = simple avg of member teams' rg_factor (Park Factors, by conference_id)
//   - offensive_power_rating (OPR) = Overall_Power_Rating (PA-avg hitters' overall PR) [reconcile display col]
//   - hitter_talent_plus (HTP) = OPR + 1.25*(Stuff+-100) + 0.75*(100 - run_env_factor)  [PARK SWAP]
// Default dry-run; --apply to persist. STORED, read-only downstream (no live compute).
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// ★ STAGE-0 double-keyed env guard (2026-08-30). This script had NO guard: `--env-file .env.production.local`
// would write PROD with zero opt-in. C28 is a DESTRUCTIVE rebuild of the conference baselines that every
// projection's competition-translation consumes, so the URL and the --prod flag must AGREE or it refuses to run.
{
  const _u = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const _isProd = /trbvxuoliwrfowibatkm/.test(_u);
  const _pf = process.argv.includes("--prod");
  if (_isProd && !_pf) { console.error("\u2717 URL is PROD but --prod was not passed — refusing."); process.exit(1); }
  if (!_isProd && _pf) { console.error("\u2717 --prod passed but URL is not prod — refusing."); process.exit(1); }
  console.log(`[env] ${_isProd ? "PROD" : "STAGING/other"}`);
}

const SEASON = 2026, APPLY = process.argv.includes("--apply");
const { data: pf } = await (sb as any).from("Park Factors").select("team_id, source_team_id, rg_factor").eq("season",SEASON);
const rgByTeam=new Map((pf||[]).map((p:any)=>[String(p.team_id),p.rg_factor])), rgBySrc=new Map((pf||[]).map((p:any)=>[String(p.source_team_id),p.rg_factor]));
const { data: all } = await (sb as any).from("Conference Stats").select("*").eq("season",SEASON).eq("division","D1");
const rows=(all||[]).filter((r:any)=>!String(r["conference abbreviation"]||"").startsWith("NJCAA"));
console.log(`${APPLY?"APPLY":"DRY-RUN"} — ${rows.length} clean D1 confs\nconf | OPR | Stuff+ | run_env(new) | HTP old(100-wRC+) → new(park swap)`);
let wrote=0;
for(const r of rows){
  const cid=r.conference_id; if(!cid) continue;
  const { data: teams } = await (sb as any).from("Teams Table").select("id, source_id").eq("Season",SEASON).eq("conference_id",cid);
  const rgs=(teams||[]).map((t:any)=>rgByTeam.get(String(t.id))??rgBySrc.get(String(t.source_id))).filter((v:any)=>v!=null);
  const runEnv = rgs.length ? Math.round((rgs.reduce((a:number,b:number)=>a+b,0)/rgs.length)*1000)/1000 : r.run_env_factor;
  const opr = r.Overall_Power_Rating;            // OPR = PA-avg hitters' overall PR
  const stuff = r.Stuff_plus, wrc = r.WRC_plus;
  if(opr==null||stuff==null||runEnv==null){ console.log(`  ${r["conference abbreviation"]}: SKIP (null input)`); continue; }
  const htpNew = Math.round((opr + 1.25*(stuff-100) + 0.75*(100-runEnv))*10)/10;
  const htpOld = wrc!=null ? Math.round((opr + 1.25*(stuff-100) + 0.75*(100-wrc))*10)/10 : null;
  console.log(`  ${(r["conference abbreviation"]||"").padEnd(11)} | ${opr} | ${stuff} | ${runEnv} | ${htpOld} → ${htpNew}`);
  if(APPLY){ const { error } = await (sb as any).from("Conference Stats").update({ run_env_factor: runEnv, offensive_power_rating: opr, hitter_talent_plus: htpNew }).eq("conference_id",cid).eq("season",SEASON); if(error) console.log(`    ERR: ${error.message}`); else wrote++; }
}
console.log(`\n${APPLY?`APPLIED ${wrote}`:"DRY-RUN"} rows.`);
