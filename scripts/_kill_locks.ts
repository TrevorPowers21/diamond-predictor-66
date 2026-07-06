import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Terminate any active UPDATE on pitch_log that's been running > 30s
// (the stuck single-statement backfills holding row locks). exec_sql
// returns void but pg_terminate_backend's side effect still fires.
const SQL = `
SELECT pg_terminate_backend(a.pid)
FROM pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
  AND a.datname = current_database()
  AND a.pid IN (
    SELECT l.pid FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = 'pitch_log'
  )
  AND a.state IN ('active', 'idle in transaction')
  AND now() - a.xact_start > interval '45 seconds';
`;

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL);
  const { error } = await (sb as any).rpc("exec_sql", { sql: SQL });
  if (error) { console.error("exec_sql err:", error.message); process.exit(1); }
  console.log("terminate issued OK");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
