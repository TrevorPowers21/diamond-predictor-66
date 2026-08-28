/**
 * STAGING CATALOG SWEEP (read-only) — hunt for the v2 classifier saved as a Postgres function/view/matview,
 * whose definition would still hold the LITERAL constants. Also dump the fullest reclass query text from
 * pg_stat_statements. Uses the exec_sql RPC (service role, staging).
 *   npx tsx --env-file .env.local scripts/_catalog_sweep.ts
 */
import { createClient } from "@supabase/supabase-js";
const url = process.env.VITE_SUPABASE_URL || "";
if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;

async function q(sql: string): Promise<any> {
  const { data, error } = await sb.rpc("exec_sql", { sql });
  return { data, error: error?.message };
}
(async () => {
  // 0) does exec_sql return rows?
  const t = await q("select 1 as ok");
  console.log("exec_sql probe →", JSON.stringify(t).slice(0, 300));

  const SIG = "%sweeper%|%4S FB%|%pf_velo%|%gyro%|%_reclass%";
  const like = (col: string) => SIG.split("|").map((s) => `${col} ilike '${s.replace(/%/g, "%")}'`).join(" or ");

  console.log("\n=== FUNCTIONS referencing classifier signatures (pg_proc) ===");
  console.log(JSON.stringify(await q(
    `select n.nspname as schema, p.proname as name, left(pg_get_functiondef(p.oid), 4000) as def
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname not in ('pg_catalog','information_schema')
       and (${like("pg_get_functiondef(p.oid)")}) limit 10`)).slice(0, 6000));

  console.log("\n=== VIEWS referencing classifier signatures (pg_views) ===");
  console.log(JSON.stringify(await q(
    `select schemaname, viewname, left(definition,4000) as def from pg_views
     where schemaname not in ('pg_catalog','information_schema') and (${like("definition")}) limit 10`)).slice(0, 6000));

  console.log("\n=== MATVIEWS referencing classifier signatures ===");
  console.log(JSON.stringify(await q(
    `select schemaname, matviewname, left(definition,4000) as def from pg_matviews where (${like("definition")}) limit 10`)).slice(0, 4000));

  console.log("\n=== any _reclass* tables/relations ===");
  console.log(JSON.stringify(await q(
    `select relname, relkind from pg_class where relname ilike '%reclass%' or relname ilike '%_seed%'`)));

  console.log("\n=== longest pg_stat_statements reclass query (full text) ===");
  console.log(JSON.stringify(await q(
    `select length(query) len, query from pg_stat_statements
     where query ilike '%pitch_type_reclassified%' or query ilike '%_reclass_result%' or query ilike '%pf_velo%'
     order by length(query) desc limit 3`)).slice(0, 8000));
})().catch((e) => { console.error(e); process.exit(1); });
