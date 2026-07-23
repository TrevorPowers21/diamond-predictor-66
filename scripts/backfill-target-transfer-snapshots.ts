import { createClient } from "@supabase/supabase-js";
const APPLY = process.argv.includes("--apply");
const sb=createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const F="player_id,customer_team_id,model_type,variant,p_avg,p_obp,p_slg,p_wrc_plus,p_era,p_fip,p_whip,p_k9,p_bb9,p_hr9,p_rv_plus,p_war,o_war,market_value,twp_hitter_market_value,twp_pitcher_market_value";
async function page(tbl:string,sel:string,flt:(q:any)=>any){let f=0,out:any[]=[];while(true){let q=sb.from(tbl).select(sel);q=flt(q);const{data,error}=await q.range(f,f+999);if(error)throw error;out=out.concat(data||[]);if(!data||data.length<1000)break;f+=1000;}return out;}
(async()=>{
  const tb=await page("target_board","id,player_id,customer_team_id,transfer_snapshot",q=>q);
  const pids=[...new Set(tb.map((r:any)=>r.player_id).filter(Boolean))];
  // fetch predictions for these players
  // Paginate WITHIN each batch — .in() over many players blows past the 1000-row
  // cap (each player has ~16 predictions). CRITICAL: order by a stable key, else
  // .range() returns rows in arbitrary order and page 2 overlaps page 1, silently
  // dropping whole players (that's how Bell/Grindlinger vanished).
  let preds:any[]=[];for(let i=0;i<pids.length;i+=100){const batch=pids.slice(i,i+100);let f=0;while(true){const{data,error}=await sb.from("player_predictions").select(F).eq("season",2027).in("player_id",batch).order("id",{ascending:true}).range(f,f+999);if(error)throw error;preds=preds.concat(data||[]);if(!data||data.length<1000)break;f+=1000;}}
  const byPlayer=new Map<string,any[]>();for(const p of preds){if(!byPlayer.has(p.player_id))byPlayer.set(p.player_id,[]);byPlayer.get(p.player_id)!.push(p);}
  const pick=(pid:string,ctid:string)=>{const rows=byPlayer.get(pid)||[];
    return rows.find(r=>r.customer_team_id===ctid && r.variant==="precomputed")
      ?? rows.find(r=>r.model_type==="returner"&&r.variant==="regular"&&r.customer_team_id==null)
      ?? rows.find(r=>r.customer_team_id===ctid) ?? rows[0] ?? null;};
  let ok=0,noPred=0; const updates:{id:string,transfer_snapshot:any}[]=[]; const samples:string[]=[];
  for(const r of tb){
    const p=pick(r.player_id,r.customer_team_id);
    if(!p){noPred++;continue;}
    const snap={p_avg:p.p_avg,p_obp:p.p_obp,p_slg:p.p_slg,p_wrc_plus:p.p_wrc_plus,p_era:p.p_era,p_fip:p.p_fip,p_whip:p.p_whip,p_k9:p.p_k9,p_bb9:p.p_bb9,p_hr9:p.p_hr9,p_rv_plus:p.p_rv_plus,p_war:p.p_war,owar:p.o_war,nil_valuation:p.market_value,twp_hitter_market_value:p.twp_hitter_market_value,twp_pitcher_market_value:p.twp_pitcher_market_value};
    updates.push({id:r.id,transfer_snapshot:snap}); ok++;
    if(samples.length<6) samples.push(`  ${r.player_id.slice(0,8)} ctid=${r.customer_team_id.slice(0,8)}: ${p.o_war!=null?`oWAR=${Number(p.o_war).toFixed(3)}`:`pWAR=${p.p_war?.toFixed?.(3)}`} wRC+=${p.p_wrc_plus} rv=${p.p_rv_plus} mkt=${p.market_value==null?"-":Math.round(p.market_value)} twpH=${p.twp_hitter_market_value==null?"-":Math.round(p.twp_hitter_market_value)} twpP=${p.twp_pitcher_market_value==null?"-":Math.round(p.twp_pitcher_market_value)}`);
  }
  console.log(`target_board rows=${tb.length}  toBackfill=${ok}  noPrediction=${noPred}  APPLY=${APPLY}`);
  console.log("samples:"); samples.forEach(s=>console.log(s));
  if(APPLY){for(let i=0;i<updates.length;i++){await sb.from("target_board").update({transfer_snapshot:updates[i].transfer_snapshot}).eq("id",updates[i].id);if((i+1)%50===0)process.stdout.write(`\r  written ${i+1}/${updates.length}`);}console.log(`\n  done (${updates.length}).`);}
  else console.log("DRY RUN — no writes. Add --apply.");
})();
