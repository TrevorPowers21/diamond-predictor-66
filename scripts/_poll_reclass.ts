import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function nullCount(): Promise<number> {
  const { count } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("pitch_type_reclassified", null);
  return count ?? -1;
}

async function main() {
  const start = Date.now();
  let last = -1, stable = 0;
  console.log("Polling pitch_type_reclassified IS NULL count every 30s...");
  while (true) {
    const c = await nullCount();
    const e = Math.round((Date.now() - start) / 1000);
    console.log(`[t+${e}s] null_count=${c.toLocaleString()}`);
    // Expected stable value: ~386K (rows where pitch_type is null/UN OR is_data=false)
    // If it drops to under 500K and is stable for 2 polls, we're done.
    if (c < 500_000 && c === last) {
      stable++;
      if (stable >= 2) {
        console.log(`✅ Stable at ${c.toLocaleString()} — done.`);
        break;
      }
    } else {
      stable = 0;
    }
    if (e > 600) {
      console.log("⏱ Polled for 10 minutes without converging; check manually.");
      break;
    }
    last = c;
    await new Promise((r) => setTimeout(r, 30000));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
