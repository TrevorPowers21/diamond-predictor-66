import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const TYPES = [
  "4-Seam Fastball","Sinker","Cutter","Slider","Sweeper","Gyro Slider",
  "Curveball","Change-up","Splitter",
];

async function main() {
  const start = Date.now();
  console.log("Querying each pitch type independently (uses idx_pitch_log_reclassified_hand)...");
  for (const t of TYPES) {
    const { count, error } = await (sb as any)
      .from("pitch_log")
      .select("uniq_pitch_id", { count: "exact", head: true })
      .eq("pitch_type_reclassified", t);
    console.log(`  ${t.padEnd(20)}: ${error ? `ERROR ${error.message || error.code}` : count?.toLocaleString() ?? "null"}`);
  }
  const { count: nullCount, error: nullErr } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("pitch_type_reclassified", null);
  console.log(`  ${"NULL".padEnd(20)}: ${nullErr ? `ERROR ${nullErr.message}` : nullCount?.toLocaleString()}`);
  console.log(`\nTotal query time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
