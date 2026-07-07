import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL, "\n");

  // Pull a chunk of (batter_id, batter_hand) and find batters that appear as BOTH L and R.
  // If switch hitters show both, batter_hand is per-PA actual stance (not static).
  const seen = new Map<string, Set<string>>();
  let from = 0;
  const PAGE = 1000;
  let scanned = 0;
  // Sample: walk a window of rows. We don't need all 2.5M — a few hundred k
  // is plenty to surface switch hitters.
  while (scanned < 400000) {
    const { data, error } = await (sb as any)
      .from("pitch_log")
      .select("batter_id, batter_hand")
      .not("batter_hand", "is", null)
      .range(from, from + PAGE - 1);
    if (error) { console.error("err:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!seen.has(r.batter_id)) seen.set(r.batter_id, new Set());
      seen.get(r.batter_id)!.add(r.batter_hand);
    }
    scanned += data.length;
    from += PAGE;
  }

  const bothSides = [...seen.entries()].filter(([, hands]) => hands.size > 1);
  console.log(`scanned ~${scanned} rows, ${seen.size} distinct batters`);
  console.log(`batters appearing as BOTH L and R (switch hitters): ${bothSides.length}`);
  console.log("\nfirst 8 switch-hitter batter_ids:");
  for (const [id, hands] of bothSides.slice(0, 8)) {
    console.log(`  ${id}  hands=${[...hands].sort().join("/")}`);
  }

  // For one of them, show the per-side batted-ball split to confirm it's real PA-level data
  if (bothSides.length > 0) {
    const sid = bothSides[0][0];
    for (const h of ["L", "R"]) {
      const { count } = await (sb as any)
        .from("pitch_log")
        .select("*", { count: "exact", head: true })
        .eq("batter_id", sid)
        .eq("batter_hand", h)
        .eq("is_batted_ball_in_play", true);
      console.log(`  batter ${sid}  batted-as-${h}: ${count} BIP`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
