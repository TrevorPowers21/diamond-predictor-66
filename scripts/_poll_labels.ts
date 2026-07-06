import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function centerCount(): Promise<number> {
  const { count } = await (sb as any)
    .from("pitch_log")
    .select("*", { count: "exact", head: true })
    .eq("hit_location", "center");
  return count ?? 0;
}

async function main() {
  for (let i = 0; i < 25; i++) {
    const c = await centerCount();
    console.log(`[poll ${i}] hit_location='center': ${c}`);
    if (c > 0) {
      // committed — print full breakdown
      const out: Record<string, number> = {};
      for (const v of ["far_left", "left_center", "center", "right_center", "far_right"]) {
        const { count } = await (sb as any).from("pitch_log").select("*", { count: "exact", head: true }).eq("hit_location", v);
        out[v] = count ?? 0;
      }
      console.log("DONE. hit_location:", JSON.stringify(out));
      const total = Object.values(out).reduce((a, b) => a + b, 0);
      console.log("total labeled BIP:", total);
      return;
    }
    await sleep(30000);
  }
  console.log("gave up after 25 polls (~12 min) — still 0, check manually");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
