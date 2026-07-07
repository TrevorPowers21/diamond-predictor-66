import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data, error } = await (sb as any)
    .from("pitch_log_pitcher_totals")
    .select("pitcher_id, total_pitches, batted_pull_allowed, batted_center_allowed, batted_oppo_allowed, batted_pull_air_allowed, batted_la_10_to_30_allowed, ev_90_allowed")
    .eq("dimension_key", "all")
    .gte("total_pitches", 200)
    .order("total_pitches", { ascending: false })
    .limit(6);
  if (error) { console.error(error.message); process.exit(1); }
  for (const r of data ?? []) {
    console.log(`${r.pitcher_id}  pitches=${r.total_pitches}  pull/cen/opp=${r.batted_pull_allowed}/${r.batted_center_allowed}/${r.batted_oppo_allowed}  pullAir=${r.batted_pull_air_allowed}  la1030=${r.batted_la_10_to_30_allowed}  EV90=${r.ev_90_allowed}`);
  }
}
main().catch(e=>{console.error(e.message);process.exit(1)});
