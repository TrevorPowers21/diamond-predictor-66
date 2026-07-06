import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function grp(col: string) {
  // small grouped read via the partial index on hit_location; fetch distinct via rpc-free approach
  const out: Record<string, number> = {};
  for (const v of col === "hit_location"
    ? ["far_left", "left_center", "center", "right_center", "far_right"]
    : ["pull", "center", "oppo"]) {
    const { count } = await (sb as any)
      .from("pitch_log")
      .select("*", { count: "exact", head: true })
      .eq(col, v);
    out[v] = count ?? -1;
  }
  return out;
}

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL, "\n");
  const loc = await grp("hit_location");
  console.log("hit_location:", JSON.stringify(loc));
  const totalLoc = Object.values(loc).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  console.log("  total labeled:", totalLoc);
  const dir = await grp("batted_direction");
  console.log("batted_direction:", JSON.stringify(dir));
}
main().catch((e) => { console.error(e.message); process.exit(1); });
