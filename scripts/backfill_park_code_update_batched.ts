/**
 * Phase C step 20 finisher — batched park_code UPDATE by ctid block range.
 * Each batch is a short, self-committing exec_sql call (survives PostgREST connection
 * recycling that kills long single UPDATEs). Nested-loop index lookup on _park_code_fix PK.
 * Reusable pattern for slow prod pitch_log column updates.
 */
import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL||"";if(!/trbvxuoliwrfowibatkm/.test(url)){console.error("NOT PROD");process.exit(1);}
const sb=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const MAXBLOCK=260000, BATCH=10000;
(async()=>{
  let batches=0;
  for(let b=0;b<=MAXBLOCK;b+=BATCH){
    const sql=`set local statement_timeout='115s'; `+
      `update pitch_log pl set park_code=f.park_code from _park_code_fix f `+
      `where f.uniq_pitch_id=pl.uniq_pitch_id and pl.ctid >= '(${b},0)'::tid and pl.ctid < '(${b+BATCH},0)'::tid and pl.park_code is distinct from f.park_code;`;
    const t0=Date.now();
    const {error}=await sb.rpc("exec_sql",{sql});
    const s=((Date.now()-t0)/1000).toFixed(0);
    if(error){console.log(`✗ blocks ${b}-${b+BATCH}: ${error.message.slice(0,50)} [${s}s]`);process.exit(1);}
    batches++; console.log(`✓ blocks ${b}-${b+BATCH} [${s}s]`);
  }
  console.log(`done — ${batches} batches committed`);
})();
