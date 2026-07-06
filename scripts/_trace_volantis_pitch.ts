/**
 * Trace ONE Volantis 4-Seam pitch through the actual Stuff+ engine and
 * compare to the stored value. If they disagree, the bug is in the
 * compute pipeline. If they agree, the engine genuinely scores his
 * physics that high.
 */
import { createClient } from "@supabase/supabase-js";
import { calculateStuffPlus, type PitchRow, type PopConstants } from "@/savant/lib/stuffPlusEngine";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Load D1 LHP 4S FB pop constants
  const { data: popData } = await (sb as any)
    .from("pitcher_stuff_plus_ncaa")
    .select("*")
    .eq("season", 2026)
    .eq("division", "D1")
    .eq("pitch_type", "4S FB")
    .eq("hand", "L")
    .limit(1);
  const pop = popData[0] as PopConstants;
  console.log("Pop constants 4S FB LHP:");
  console.log(`  Vel ${pop.velocity}±${pop.velocity_sd}  IVB ${pop.ivb}±${pop.ivb_sd}  HB ${pop.hb}±${pop.hb_sd}`);
  console.log(`  RelH ${pop.rel_height}±${pop.rel_height_sd}  RelS ${pop.rel_side}±${pop.rel_side_sd}  Ext ${pop.extension}±${pop.extension_sd}  Spin ${pop.spin}±${pop.spin_sd}`);

  // Pull a few of Volantis's 4-Seam pitches at the cap (153.8) and a few below
  const { data: cap } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, release_velocity, ivb, hb, spin, rel_height, rel_side, extension, stuff_plus")
    .eq("pitcher_id", "1979617275")
    .eq("season", 2026)
    .eq("pitch_type_reclassified", "4-Seam Fastball")
    .gte("stuff_plus", 153)
    .limit(3);
  const { data: below } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, release_velocity, ivb, hb, spin, rel_height, rel_side, extension, stuff_plus")
    .eq("pitcher_id", "1979617275")
    .eq("season", 2026)
    .eq("pitch_type_reclassified", "4-Seam Fastball")
    .lt("stuff_plus", 110)
    .limit(3);

  console.log(`\nFor each pitch: STORED stuff+ vs ENGINE recompute, then z-score breakdown.`);
  console.log(`(Subtract 6.2 for bucket recenter shift after clamp(40,160) to compare apples-to-apples)\n`);

  for (const r of [...(cap ?? []), ...(below ?? [])]) {
    const row: PitchRow = {
      velocity: r.release_velocity,
      ivb: r.ivb,
      hb: r.hb,
      spin: r.spin,
      rel_height: r.rel_height,
      rel_side: r.rel_side,
      extension: r.extension,
      hand: "L",
    } as PitchRow;
    const result = calculateStuffPlus("4S FB", row, pop)!;
    const clamped = Math.max(40, Math.min(160, result.score));
    const recentered = clamped - 6.2;
    console.log(`  Vel=${r.release_velocity}  IVB=${r.ivb}  HB=${r.hb}  Spin=${r.spin}  RelH=${r.rel_height}  RelS=${r.rel_side}`);
    console.log(`    STORED stuff+:           ${r.stuff_plus}`);
    console.log(`    ENGINE raw score:        ${result.score.toFixed(1)}`);
    console.log(`    after clamp(40,160):     ${clamped.toFixed(1)}`);
    console.log(`    after -6.2 recenter:     ${recentered.toFixed(1)}`);
    console.log(`    z_velo=${result.zs.z_velocity.toFixed(2)}  z_ivb=${result.zs.z_ivb.toFixed(2)}  z_hb=${result.zs.z_hb.toFixed(2)}  z_relH=${result.zs.z_rel_height.toFixed(2)}  z_relS=${result.zs.z_rel_side.toFixed(2)}  z_ext=${result.zs.z_extension.toFixed(2)}  z_spin=${result.zs.z_spin.toFixed(2)}`);
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
