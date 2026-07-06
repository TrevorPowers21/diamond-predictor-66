import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function snapshot() {
  // Total rows in pitch_log
  const { count: total } = await (supabase as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true });
  // Rows still pending (is_foul IS NULL)
  const { count: pending } = await (supabase as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("is_foul", null);
  return { total: total ?? 0, pending: pending ?? 0 };
}

async function main() {
  const start = Date.now();
  let last = -1;
  let stableCount = 0;
  console.log(`Polling prod pitch_log every 30s. Will stop when pending=0 or unchanged for 3 polls.`);
  while (true) {
    const { total, pending } = await snapshot();
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    const done = total - pending;
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0";
    console.log(`[t+${elapsedSec}s] processed=${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%) pending=${pending.toLocaleString()}`);
    if (pending === 0) {
      console.log("✅ Derivation complete — pending=0.");
      break;
    }
    if (pending === last) {
      stableCount++;
      if (stableCount >= 3) {
        console.log(`⚠ Pending unchanged for 3 polls (90s). UPDATE may have stalled or finished early — pending=${pending}.`);
        break;
      }
    } else {
      stableCount = 0;
    }
    last = pending;
    await new Promise((r) => setTimeout(r, 30000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
