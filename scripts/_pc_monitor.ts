import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || "";
if (!/trbvxuoliwrfowibatkm/.test(url)) { console.error("not prod"); process.exit(1); }
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// helper: active park_code update sessions
await sb.rpc("exec_sql", { sql: `create or replace function _pcmon() returns json language sql security definer as $f$
  select coalesce(json_agg(json_build_object('pid',pid,'state',state,'wait',wait_event_type||':'||coalesce(wait_event,'-'),'secs',round(extract(epoch from (now()-query_start)))::int)),'[]'::json)
  from pg_stat_activity where state='active' and query ilike '%park_code%' and query ilike '%update%' and pid<>pg_backend_pid() $f$;` });
await sb.rpc("exec_sql", { sql: "NOTIFY pgrst,'reload schema';" });
await sleep(2500);
const MAX = 40; let idle = 0;
for (let i = 1; i <= MAX; i++) {
  const { data, error } = await sb.rpc("_pcmon");
  const ups = error ? `ERR ${error.message}` : (data || []);
  const alive = Array.isArray(ups) && ups.length > 0;
  console.log(`[check ${i}] ${new Date().toISOString()} update-active=${alive} ${JSON.stringify(ups)}`);
  idle = alive ? 0 : idle + 1;
  if (idle >= 2) { console.log(`>> no active park_code UPDATE for 2 checks — stopping monitor, run final count`); break; }
  if (i < MAX) await sleep(90000);
}
await sb.rpc("exec_sql", { sql: "drop function if exists _pcmon();" });
console.log("monitor done");
