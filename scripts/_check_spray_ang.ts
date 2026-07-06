import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function cnt(build: (q: any) => any): Promise<number | null> {
  const q = build(sb.from("pitch_log").select("*", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) { console.error("err:", error.message); return null; }
  return count;
}

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL, "\n");

  const totalBip = await cnt((q) => q.eq("is_batted_ball_in_play", true));
  const withSpray = await cnt((q) => q.eq("is_batted_ball_in_play", true).not("spray_ang", "is", null));
  const withDist = await cnt((q) => q.eq("is_batted_ball_in_play", true).not("distance", "is", null));
  const withEv = await cnt((q) => q.eq("is_batted_ball_in_play", true).not("exit_velocity", "is", null));
  console.log("=== coverage among batted-balls-in-play ===");
  const pc = (n: number | null) => (n != null && totalBip ? `${((n / totalBip) * 100).toFixed(1)}%` : "");
  console.log("total BIP:      ", totalBip);
  console.log("with spray_ang: ", withSpray, pc(withSpray));
  console.log("with distance:  ", withDist, pc(withDist));
  console.log("with exit_velo: ", withEv, pc(withEv), "  <- EV is the SPARSER one");

  const bands: Array<[string, number, number]> = [
    ["FarLeft  (LF)", -45, -27],
    ["LeftCen  (LC)", -27, -9],
    ["Center   (CF)", -9, 9],
    ["RightCen (RC)", 9, 27],
    ["FarRight (RF)", 27, 45],
  ];
  console.log("\n=== 5-zone field distribution (spray_ang bands) ===");
  for (const [label, lo, hi] of bands) {
    const n = await cnt((q) =>
      q.eq("is_batted_ball_in_play", true).not("spray_ang", "is", null).gte("spray_ang", lo).lt("spray_ang", hi),
    );
    console.log(`${label}  [${String(lo).padStart(3)}, ${String(hi).padStart(3)})  ${String(n).padStart(7)}  ${pc(n)}`);
  }

  const rhbPullLF = await cnt((q) => q.eq("is_batted_ball_in_play", true).eq("batter_hand", "R").lt("spray_ang", -9));
  const rhbOppoRF = await cnt((q) => q.eq("is_batted_ball_in_play", true).eq("batter_hand", "R").gt("spray_ang", 9));
  const lhbPullRF = await cnt((q) => q.eq("is_batted_ball_in_play", true).eq("batter_hand", "L").gt("spray_ang", 9));
  const lhbOppoLF = await cnt((q) => q.eq("is_batted_ball_in_play", true).eq("batter_hand", "L").lt("spray_ang", -9));
  console.log("\n=== pull/oppo sanity ===");
  console.log(`RHB to LF (pull):  ${rhbPullLF}   RHB to RF (oppo): ${rhbOppoRF}   -> pull should exceed oppo`);
  console.log(`LHB to RF (pull):  ${lhbPullRF}   LHB to LF (oppo): ${lhbOppoLF}   -> pull should exceed oppo`);
}
main().catch((e) => { console.error(e); process.exit(1); });
