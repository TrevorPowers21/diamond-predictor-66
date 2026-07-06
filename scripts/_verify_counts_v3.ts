import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Use rpc that returns scalar from exec_sql_returns since exec_sql is void
  // Actually exec_sql is void — we have to use the PostgREST count.
  // Let's try a different approach: HEAD request with `count: 'estimated'`
  const queries: Array<[string, () => any]> = [
    ["total                 ", () => (sb as any).from("pitch_log").select("*", { count: "estimated", head: true })],
    ["pz_norm populated     ", () => (sb as any).from("pitch_log").select("*", { count: "estimated", head: true }).not("pz_norm", "is", null)],
    ["spray_ang populated   ", () => (sb as any).from("pitch_log").select("*", { count: "estimated", head: true }).not("spray_ang", "is", null)],
    ["x_avg populated       ", () => (sb as any).from("pitch_log").select("*", { count: "estimated", head: true }).not("x_avg", "is", null)],
    ["postseason (June 13-24)", () => (sb as any).from("pitch_log").select("*", { count: "estimated", head: true }).gte("date", "2026-06-13").lte("date", "2026-06-25")],
  ];
  for (const [label, q] of queries) {
    const { count, error } = await q();
    if (error) console.log(`${label}: ERROR ${error.message}`);
    else console.log(`${label}: ${count?.toLocaleString() ?? "null"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
