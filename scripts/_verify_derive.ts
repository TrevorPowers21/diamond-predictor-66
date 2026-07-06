import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // Single RPC call so we get one round-trip
  const { data, error } = await (sb as any).rpc("exec_sql_select", {
    sql: `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_foul IS NULL) AS missing_flags,
      COUNT(*) FILTER (WHERE is_foul) AS fouls,
      COUNT(*) FILTER (WHERE is_strike) AS strikes,
      COUNT(*) FILTER (WHERE is_whiff) AS whiffs,
      COUNT(*) FILTER (WHERE is_chase) AS chases
    FROM pitch_log`,
  });
  if (error) {
    // Fallback: do separate count queries
    const r1 = await (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true });
    const r2 = await (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }).is("is_foul", null);
    const r3 = await (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }).eq("is_foul", true);
    console.log("r1:", JSON.stringify(r1.error || { count: r1.count }));
    console.log("r2 (is_foul NULL):", JSON.stringify(r2.error || { count: r2.count }));
    console.log("r3 (is_foul=true):", JSON.stringify(r3.error || { count: r3.count }));
    return;
  }
  console.log(data);
}
main().catch((e) => { console.error(e); process.exit(1); });
