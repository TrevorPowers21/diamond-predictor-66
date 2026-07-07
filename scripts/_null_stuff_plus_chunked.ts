import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const CHUNK = 100_000;
const SQL = `
UPDATE public.pitch_log
SET stuff_plus = NULL
WHERE uniq_pitch_id IN (
  SELECT uniq_pitch_id FROM public.pitch_log
  WHERE season = 2026 AND stuff_plus IS NOT NULL
  ORDER BY uniq_pitch_id
  LIMIT ${CHUNK}
);`;

async function pendingCount(): Promise<number> {
  const { count } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "estimated", head: true })
    .not("stuff_plus", "is", null)
    .eq("season", 2026);
  return count ?? 0;
}

async function main() {
  let chunkNum = 0;
  const start = Date.now();
  while (true) {
    chunkNum++;
    const before = await pendingCount();
    if (before === 0) { console.log("✅ All stuff_plus NULL'd."); break; }
    const cs = Date.now();
    console.log(`Chunk ${chunkNum}: pending=${before.toLocaleString()}...`);
    const { error } = await (sb as any).rpc("exec_sql", { sql: SQL });
    if (error) { console.error(`exec_sql failed: ${error.message}`); process.exit(1); }
    const after = await pendingCount();
    const processed = before - after;
    console.log(`  → ${((Date.now() - cs) / 1000).toFixed(1)}s, ${processed.toLocaleString()} NULL'd, ${after.toLocaleString()} pending`);
    if (processed === 0) { console.error(`No progress, bailing.`); process.exit(1); }
  }
  console.log(`\nTotal: ${((Date.now() - start) / 1000).toFixed(1)}s, ${chunkNum} chunks`);
}
main().catch((e) => { console.error(e); process.exit(1); });
