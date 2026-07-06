import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const sql = readFileSync("supabase/migrations/20260624120000_pitch_log_location_spray.sql", "utf8");

async function main() {
  console.log(`Applying migration via exec_sql on ${url.replace(/https:\/\//, "").split(".")[0]}...`);
  const { error } = await (sb as any).rpc("exec_sql", { sql });
  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
  console.log("✅ Migration applied");
}
main().catch((e) => { console.error(e); process.exit(1); });
