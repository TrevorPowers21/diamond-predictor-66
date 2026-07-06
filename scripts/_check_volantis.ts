import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Find Dylan Volantis
  const { data: player } = await (sb as any)
    .from("players")
    .select("id, source_player_id, first_name, last_name, team")
    .ilike("last_name", "%Volantis%")
    .limit(5);
  console.log("players match:", JSON.stringify(player, null, 2));
  if (!player || player.length === 0) return;
  const sid = player[0].source_player_id;

  // Pull all his Stuff+ values + characteristics, sorted high to low
  const { data: rows } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, pitch_type, pitch_type_reclassified, release_velocity, ivb, hb, spin, rel_height, rel_side, stuff_plus, pitcher_hand")
    .eq("pitcher_id", sid)
    .eq("season", 2026)
    .eq("is_data", true)
    .order("stuff_plus", { ascending: false, nullsFirst: false })
    .limit(20);
  console.log("\nTop 20 stuff_plus pitches:");
  for (const r of rows ?? []) {
    console.log(`  ${r.uniq_pitch_id} | ${r.pitch_type_reclassified} | ${r.pitcher_hand} | Vel=${r.release_velocity} IVB=${r.ivb} HB=${r.hb} Spin=${r.spin} RelH=${r.rel_height} | Stuff+ ${r.stuff_plus}`);
  }

  // Distribution per pitch type
  const { data: agg } = await (sb as any)
    .from("pitch_log_pitcher_by_pitch_type")
    .select("pitch_type_reclassified, pitches, stuff_plus_sum, data_pitches")
    .eq("pitcher_id", sid)
    .eq("season", 2026)
    .eq("dimension_key", "all");
  console.log("\nAggregated Stuff+ per pitch type:");
  for (const r of agg ?? []) {
    const avg = r.data_pitches > 0 ? r.stuff_plus_sum / r.data_pitches : null;
    console.log(`  ${r.pitch_type_reclassified.padEnd(20)} pitches=${r.pitches.toString().padStart(4)} data=${r.data_pitches.toString().padStart(4)} avg_stuff+=${avg?.toFixed(1) ?? "—"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
