/**
 * Compare two ways of computing a pitcher's Stuff+:
 *   (A) Per-pitch: score every pitch, then average
 *   (B) Average-then-score: average the pitcher's metrics first, then
 *       run the engine ONCE on the average pitch
 *
 * (B) is naturally robust to outliers — a single weird pitch can pull
 * the per-pitch average way up (especially with the cap interaction).
 * Comparing both flags pitchers whose per-pitch number is being
 * inflated by outliers vs pitchers whose stuff is genuinely consistent.
 *
 * Targeted at Dylan Volantis 4-Seam Fastball to start.
 */
import { createClient } from "@supabase/supabase-js";
import { calculateStuffPlus } from "@/savant/lib/stuffPlusEngine";
import type { PitchRow, PopConstants } from "@/savant/lib/stuffPlusEngine";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const SID = "1979617275"; // Volantis
  const PITCH_TYPE = "4-Seam Fastball";
  const HAND: "L" | "R" = "L";

  // 1. Pull all his 4-Seams (data-tracked only)
  const { data: pitches } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id, release_velocity, ivb, hb, spin, rel_height, rel_side, extension, stuff_plus")
    .eq("pitcher_id", SID)
    .eq("season", 2026)
    .eq("pitch_type_reclassified", PITCH_TYPE)
    .eq("is_data", true)
    .limit(2000);
  console.log(`Volantis ${PITCH_TYPE} pitches scored on staging: ${pitches?.length}`);

  // 2. Average his metrics
  const avg = { velo: 0, ivb: 0, hb: 0, spin: 0, relH: 0, relS: 0, ext: 0, n: 0 };
  for (const r of pitches ?? []) {
    if (r.release_velocity != null) {
      avg.velo += r.release_velocity;
      avg.ivb += r.ivb ?? 0;
      avg.hb += r.hb ?? 0;
      avg.spin += r.spin ?? 0;
      avg.relH += r.rel_height ?? 0;
      avg.relS += r.rel_side ?? 0;
      avg.ext += r.extension ?? 0;
      avg.n += 1;
    }
  }
  const m = (v: number) => v / avg.n;
  console.log(`\nAverage 4-Seam features:`);
  console.log(`  Vel=${m(avg.velo).toFixed(1)}  IVB=${m(avg.ivb).toFixed(1)}  HB=${m(avg.hb).toFixed(1)}  Spin=${Math.round(m(avg.spin))}  RelH=${m(avg.relH).toFixed(2)}  RelS=${m(avg.relS).toFixed(2)}  Ext=${m(avg.ext).toFixed(2)}`);

  // 3. Per-pitch Stuff+ average + median + cap counts
  const stuffs = (pitches ?? []).map((p: any) => p.stuff_plus).filter((s: any) => s != null) as number[];
  stuffs.sort((a, b) => a - b);
  const perPitchAvg = stuffs.reduce((a, b) => a + b, 0) / stuffs.length;
  const perPitchMedian = stuffs[Math.floor(stuffs.length / 2)];
  const atCap = stuffs.filter((s) => s >= 153.7).length; // 153.8 cap for 4-Seam LHP
  console.log(`\nPer-pitch Stuff+ distribution (${stuffs.length} scored):`);
  console.log(`  Avg=${perPitchAvg.toFixed(1)}   Median=${perPitchMedian.toFixed(1)}   Min=${stuffs[0]}  Max=${stuffs[stuffs.length-1]}`);
  console.log(`  Pitches at cap (≥153.7): ${atCap} (${((atCap/stuffs.length)*100).toFixed(0)}%)`);

  // 4. Average-then-score: build a synthetic "average pitch" and run the engine
  // Need pop constants. Use 2026 D1 numbers for 4-Seam LHP from our staging data.
  // Approximate from earlier NCAA_MOVEMENT_AVERAGES + reasonable defaults.
  const pop: PopConstants = {
    velocity: 87.5, velocity_sd: 3.5,
    ivb: 15.92, ivb_sd: 4.53,
    hb: -10.51, hb_sd: 5.37,
    rel_height: 5.6, rel_height_sd: 0.55,
    rel_side: -1.5, rel_side_sd: 1.0,
    extension: 6.1, extension_sd: 0.55,
    spin: 2240, spin_sd: 180,
  };
  const avgRow: PitchRow = {
    velocity: m(avg.velo),
    ivb: m(avg.ivb),
    hb: m(avg.hb),
    rel_height: m(avg.relH),
    rel_side: m(avg.relS),
    extension: m(avg.ext),
    spin: m(avg.spin),
    hand: HAND,
  } as PitchRow;
  const result = calculateStuffPlus("4S FB", avgRow, pop)!;
  console.log(`\nAverage-then-score Stuff+ (running engine on his avg-pitch features):`);
  console.log(`  Score (uncapped, unrecentered): ${result.score.toFixed(1)}`);
  console.log(`  After clamp(40,160): ${Math.max(40, Math.min(160, result.score)).toFixed(1)}`);
  console.log(`  After bucket-recenter (shift 6.2): ${(Math.max(40, Math.min(160, result.score)) - 6.2).toFixed(1)}`);
  console.log(`\nZ-scores breakdown:`);
  for (const [k, v] of Object.entries(result.zs)) {
    console.log(`  ${k}: ${v.toFixed(2)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
