import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // far_left rows: RHB should be 'pull', LHB 'oppo'. Uses hit_location index.
  const { data } = await (sb as any).from("pitch_log")
    .select("spray_ang, batter_hand, hit_location, batted_direction")
    .eq("hit_location", "far_left").limit(8);
  for (const r of data ?? []) console.log(`spray=${r.spray_ang} hand=${r.batter_hand} loc=${r.hit_location} dir=${r.batted_direction}`);
  // null-direction count among labeled (should be tiny — only null batter_hand)
  const { count: nullDir } = await (sb as any).from("pitch_log")
    .select("*", { count: "exact", head: true }).not("hit_location","is",null).is("batted_direction", null);
  console.log("labeled rows with NULL direction:", nullDir);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
