import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const dir = process.argv[2];
const started = new Date(Date.now() - 60000).toISOString(); // 1 min ago (clock-skew margin)
const tasks = [
  { file: "vs_top_hitters_pitcher_totals.sql",        table: "pitch_log_pitcher_totals" },
  { file: "vs_top_hitters_pitcher_by_pitch_type.sql", table: "pitch_log_pitcher_by_pitch_type" },
  { file: "vs_top_hitters_pitcher_by_zone.sql",       table: "pitch_log_pitcher_by_zone" },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function freshCommit(table: string): Promise<boolean> {
  const { data, error } = await (sb as any).from(table)
    .select("computed_at").eq("dimension_key", "vs_top_hitters").gte("computed_at", started).limit(1);
  return !error && !!data && data.length > 0;
}
(async () => {
  console.log("URL:", process.env.VITE_SUPABASE_URL, "| started cutoff:", started);
  for (const t of tasks) {
    console.log(`\n=== ${t.file} ===`);
    const sql = readFileSync(`${dir}/${t.file}`, "utf8");
    const t0 = Date.now();
    const { error } = await (sb as any).rpc("exec_sql", { sql });
    console.log(`  fired in ${((Date.now()-t0)/1000).toFixed(0)}s${error ? ` (client timeout — server still committing: ${error.message.slice(0,45)})` : " (returned OK)"}`);
    let ok = false;
    for (let i = 0; i < 30; i++) { // up to 30 x 20s = 10 min
      if (await freshCommit(t.table)) { ok = true; console.log(`  ✓ committed (verified after ~${i*20}s poll)`); break; }
      await sleep(20000);
    }
    if (!ok) { console.log(`  ✗ NOT committed after 10 min — STOP`); process.exit(1); }
  }
  console.log("\n✅ All 3 vs_top_hitters statements committed.");
})().catch((e) => { console.error(e.message); process.exit(1); });
