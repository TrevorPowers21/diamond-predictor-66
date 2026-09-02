import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL||"";if(!/trbvxuoliwrfowibatkm/.test(url)){process.exit(1);}
const sb=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
await sb.rpc("exec_sql",{sql:`create or replace function _poll() returns int language sql security definer as $f$ select count(*)::int from pg_stat_activity where state='active' and application_name='postgrest' and query_start<now()-interval '10 seconds' $f$;`});
await sb.rpc("exec_sql",{sql:"NOTIFY pgrst,'reload schema';"}); await new Promise(r=>setTimeout(r,1500));
for(let i=0;i<40;i++){
  const {data:pc}=await sb.from("pitch_log").select("park_code").not("park_code","is",null).limit(1);
  if(pc?.length){console.log(`✅ park_code COMMITTED after ~${i} min`);break;}
  const {data:act}=await sb.rpc("_poll");
  if((Number(act)||0)===0){console.log(`⚠ UPDATE query GONE and park_code still null after ~${i} min → rolled back / timed out`);break;}
  await new Promise(r=>setTimeout(r,60000));
}
await sb.rpc("exec_sql",{sql:"drop function if exists _poll();"});
console.log("poll ended");
