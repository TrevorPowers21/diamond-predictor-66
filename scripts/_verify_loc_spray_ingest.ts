import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log(`Verifying staging pitch_log (${url.replace(/https:\/\//, "").split(".")[0]}):\n`);

  // Total pitches
  const { count: total } = await (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true });
  console.log(`Total pitches      : ${total?.toLocaleString()}`);

  // New-field population
  const checks: Array<[string, string]> = [
    ["pz_norm populated  ", "pz_norm"],
    ["px_norm populated  ", "px_norm"],
    ["spray_ang populated", "spray_ang"],
    ["distance populated ", "distance"],
    ["x_avg populated    ", "x_avg"],
    ["x_slg populated    ", "x_slg"],
    ["x_woba populated   ", "x_woba"],
  ];
  for (const [label, col] of checks) {
    const { count } = await (sb as any)
      .from("pitch_log")
      .select("uniq_pitch_id", { count: "exact", head: true })
      .not(col, "is", null);
    const pct = total ? ((count ?? 0) / total * 100).toFixed(1) : "?";
    console.log(`${label}: ${count?.toLocaleString().padStart(10)} (${pct}%)`);
  }

  // June postseason pitches added (CWS dates)
  const { count: postseason } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .gte("date", "2026-06-13")
    .lte("date", "2026-06-25");
  console.log(`\nPostseason pitches (June 13-24): ${postseason?.toLocaleString()}`);

  // Sample new-data row
  const { data: sample } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, date, batter_abbrev_name, pitch_type, exit_velocity, launch_angle, spray_ang, distance, x_avg, x_slg, x_woba, pz_norm, px_norm")
    .eq("is_batted_ball_in_play", true)
    .not("spray_ang", "is", null)
    .limit(3);
  console.log(`\nSample batted-ball rows with new fields:`);
  for (const r of sample ?? []) {
    console.log(`  ${r.uniq_pitch_id} | ${r.batter_abbrev_name} | ${r.pitch_type} EV=${r.exit_velocity} LA=${r.launch_angle} | spray=${r.spray_ang}° dist=${r.distance}ft | xAvg=${r.x_avg} xSlg=${r.x_slg} xWoba=${r.x_woba}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
