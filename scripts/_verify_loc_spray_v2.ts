import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Get counts via a single SELECT — much faster + works around PostgREST quirks
  console.log("Pulling sample with EV populated to check xStats...");
  const { data: ev_sample } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, batter_abbrev_name, pitch_type, exit_velocity, launch_angle, spray_ang, distance, x_avg, x_slg, x_woba")
    .eq("is_batted_ball_in_play", true)
    .not("exit_velocity", "is", null)
    .not("spray_ang", "is", null)
    .limit(5);
  console.log("\nEV-tracked + spray-tracked samples:");
  for (const r of ev_sample ?? []) {
    console.log(`  ${r.uniq_pitch_id} | ${r.batter_abbrev_name} | ${r.pitch_type} EV=${r.exit_velocity} LA=${r.launch_angle} | spray=${r.spray_ang}° dist=${r.distance}ft | xAvg=${r.x_avg} xSlg=${r.x_slg} xWoba=${r.x_woba}`);
  }

  // Sample of EV-tracked but no xStats
  const { data: no_xstats } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, pitch_type, exit_velocity, launch_angle, x_avg")
    .eq("is_batted_ball_in_play", true)
    .not("exit_velocity", "is", null)
    .is("x_avg", null)
    .limit(3);
  console.log("\nEV-tracked but no TM xStats (would expect null xAvg):");
  for (const r of no_xstats ?? []) {
    console.log(`  ${r.uniq_pitch_id} | ${r.pitch_type} EV=${r.exit_velocity} LA=${r.launch_angle} | xAvg=${r.x_avg}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
