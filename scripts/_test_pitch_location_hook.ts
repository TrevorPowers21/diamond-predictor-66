import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Hudson Brown — batter_id 1342167668
  const cols =
    "uniq_pitch_id, pitch_type_reclassified, px_norm, pz_norm, " +
    "exit_velocity, launch_angle, spray_ang, distance, x_avg, pitch_result_category, is_batted_ball_in_play";

  const PAGE = 1000;
  let lastId = "";
  let rows: any[] = [];
  while (true) {
    let q = (sb as any).from("pitch_log").select(cols).eq("batter_id", "1342167668").eq("season", 2026).order("uniq_pitch_id", { ascending: true }).limit(PAGE);
    if (lastId) q = q.gt("uniq_pitch_id", lastId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    lastId = data[data.length - 1].uniq_pitch_id;
    if (data.length < PAGE) break;
  }

  console.log(`Hudson Brown total pitches seen: ${rows.length}`);
  console.log(`With px_norm/pz_norm tracked: ${rows.filter((r) => r.px_norm != null && r.pz_norm != null).length}`);
  const batted = rows.filter((r) => r.is_batted_ball_in_play === true);
  const sprayed = batted.filter((r) => r.spray_ang != null && r.distance != null);
  console.log(`Batted balls in play: ${batted.length} (${sprayed.length} with spray)`);

  console.log(`\n3 sample rows:`);
  for (const r of rows.slice(0, 3)) {
    console.log(`  ${r.uniq_pitch_id} | ${r.pitch_type_reclassified} | PXNorm=${r.px_norm?.toFixed(2)} PZNorm=${r.pz_norm?.toFixed(2)}`);
  }

  console.log(`\n3 sample batted balls:`);
  for (const r of sprayed.slice(0, 3)) {
    console.log(`  ${r.uniq_pitch_id} | spray=${r.spray_ang}° dist=${r.distance}ft EV=${r.exit_velocity} LA=${r.launch_angle} → ${r.pitch_result_category}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
