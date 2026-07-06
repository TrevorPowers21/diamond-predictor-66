import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  console.log("NULLing all stuff_plus values for season 2026 via exec_sql RPC...");
  const sql = `UPDATE public.pitch_log SET stuff_plus = NULL WHERE season = 2026 AND stuff_plus IS NOT NULL;`;
  const { error } = await (sb as any).rpc("exec_sql", { sql });
  if (error) { console.error("Error:", error.message); process.exit(1); }
  console.log("✅ Done");
}
main().catch((e) => { console.error(e); process.exit(1); });
