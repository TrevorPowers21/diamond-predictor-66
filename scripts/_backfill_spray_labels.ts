import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function hitLocation(spray: number): string {
  if (spray < -30) return "far_left";
  if (spray < -15) return "left_center";
  if (spray <= 15) return "center";
  if (spray <= 30) return "right_center";
  return "far_right";
}
function battedDirection(spray: number, hand: string | null): string | null {
  if (hand == null) return null;
  if (spray >= -15 && spray <= 15) return "center";
  if (hand === "R") return spray < -15 ? "pull" : "oppo";
  if (hand === "L") return spray > 15 ? "pull" : "oppo";
  return null;
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function execWithRetry(sql: string, tries = 5): Promise<void> {
  for (let t = 0; t < tries; t++) {
    const { error } = await (sb as any).rpc("exec_sql", { sql });
    if (!error) return;
    if (t === tries - 1) { console.error("exec_sql err:", error.message); process.exit(1); }
    await sleep(1500 * (t + 1)); // back off on transient lock/timeout
  }
}

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL);
  const FETCH = 5000;
  let lastId = "", scanned = 0, written = 0;
  const t0 = Date.now();
  while (true) {
    // Page by PRIMARY KEY (fast index scan, no seq-scan timeout). Filter in JS.
    let data: any[] | null = null;
    for (let t = 0; t < 6; t++) {
      let sel = (sb as any)
        .from("pitch_log")
        .select("uniq_pitch_id, spray_ang, batter_hand, is_batted_ball_in_play, hit_location")
        .order("uniq_pitch_id", { ascending: true })
        .limit(FETCH);
      if (lastId) sel = sel.gt("uniq_pitch_id", lastId);
      const res = await sel;
      if (!res.error) { data = res.data; break; }
      if (t === 5) { console.error("SELECT err:", res.error.message); process.exit(1); }
      await sleep(2000 * (t + 1)); // back off on transient fetch/network failure
    }
    if (!data || data.length === 0) break;

    const todo = data.filter((r: any) =>
      r.is_batted_ball_in_play && r.hit_location == null &&
      r.spray_ang != null && r.spray_ang >= -45 && r.spray_ang <= 45);
    if (todo.length > 0) {
      const values = todo.map((r: any) => {
        const dir = battedDirection(r.spray_ang, r.batter_hand);
        return `(${q(r.uniq_pitch_id)},${q(hitLocation(r.spray_ang))},${dir == null ? "NULL" : q(dir)})`;
      }).join(",");
      await execWithRetry(`UPDATE public.pitch_log AS p
        SET hit_location = v.loc::text, batted_direction = v.dir::text
        FROM (VALUES ${values}) AS v(id, loc, dir)
        WHERE p.uniq_pitch_id = v.id;`);
      written += todo.length;
    }
    scanned += data.length;
    lastId = data[data.length - 1].uniq_pitch_id;
    if (scanned % 100000 < FETCH) {
      const rate = scanned / ((Date.now() - t0) / 1000);
      console.log(`  scanned ${scanned}, written ${written}  (${rate.toFixed(0)}/s)`);
    }
  }
  console.log(`DONE. scanned ${scanned}, written ${written} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
