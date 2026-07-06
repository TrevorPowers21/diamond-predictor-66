import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const file = process.argv[2];
  const sql = readFileSync(file, "utf8");
  console.log(`Running ${file} via exec_sql (${sql.length} chars)...`);
  const t0 = Date.now();
  const { error } = await (sb as any).rpc("exec_sql", { sql });
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  if (error) console.log(`exec_sql returned error after ${dt}s: ${error.message} (may still be running server-side)`);
  else console.log(`exec_sql OK in ${dt}s`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
