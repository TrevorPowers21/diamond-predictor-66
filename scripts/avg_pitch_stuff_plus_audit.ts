/**
 * Sanity-check Stuff+ by computing it two ways for every (pitcher × pitch_type)
 * on staging:
 *
 *   (A) Per-pitch mean — what we currently display (stuff_plus_sum / data_pitches)
 *   (B) Average-pitch — average the pitcher's raw physics (velo / IVB / HB / spin /
 *       release / extension) over all his data-tracked pitches of that type,
 *       then run the Stuff+ engine ONCE on the synthetic average pitch
 *
 * (B) is the cleaner profile-level number. When (A) and (B) disagree by more
 * than the flag threshold, the per-pitch mean is being skewed (outliers,
 * tracking errors, or simply high variance within the pitcher's arsenal).
 *
 * Reports the top divergences sorted by absolute difference.
 *
 * Usage:
 *   npm run avg-pitch-stuff-plus-audit -- [--season 2026] [--min-pitches 50] [--flag 15]
 */
import { createClient } from "@supabase/supabase-js";
import { calculateStuffPlus, type PitchRow, type PopConstants } from "../src/savant/lib/stuffPlusEngine";

const SEASON = Number(process.argv.find((a) => a.startsWith("--season"))?.split("=")[1] ?? 2026);
const MIN_PITCHES = Number(process.argv.find((a) => a.startsWith("--min-pitches"))?.split("=")[1] ?? 50);
const FLAG_DIFF = Number(process.argv.find((a) => a.startsWith("--flag"))?.split("=")[1] ?? 15);

// pitch_type_reclassified (display) → engine pitch_type label
const RECLASS_TO_ENGINE: Record<string, string> = {
  "4-Seam Fastball": "4S FB",
  "Sinker": "Sinker",
  "Cutter": "Cutter",
  "Gyro Slider": "Gyro Slider",
  "Slider": "Slider",
  "Sweeper": "Sweeper",
  "Curveball": "Curveball",
  "Change-up": "Change-up",
  "Splitter": "Splitter",
};

// pop bucket lookup uses engine label
const ENGINE_TO_RECLASS = Object.fromEntries(Object.entries(RECLASS_TO_ENGINE).map(([k, v]) => [v, k]));

async function main() {
  const url = process.env.VITE_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Avg-pitch Stuff+ audit on ${url.replace("https://", "").split(".")[0]}, season ${SEASON}`);
  console.log(`Flagging diffs > ±${FLAG_DIFF} Stuff+, ignoring buckets with < ${MIN_PITCHES} data pitches\n`);

  // Pop constants per (engine_pitch_type × hand)
  const { data: popRows } = await (sb as any)
    .from("pitcher_stuff_plus_ncaa")
    .select("*")
    .eq("season", SEASON)
    .eq("division", "D1");
  const popMap = new Map<string, PopConstants>();
  for (const p of popRows as any[]) popMap.set(`${p.pitch_type}::${p.hand}`, p as PopConstants);
  console.log(`Loaded ${popMap.size} pop buckets`);

  // Walk every (pitcher × pitch_type) with sufficient pitches via keyset pagination
  type Bucket = {
    pitcher_id: string;
    pitch_type_reclassified: string;
    pitcher_hand: "L" | "R";
    n: number;
    velocity: number; ivb: number; hb: number; spin: number; rel_height: number; rel_side: number; extension: number;
    stuff_sum: number; stuff_n: number;
  };
  const buckets = new Map<string, Bucket>();

  const CHUNK = 50_000;
  let lastId = "";
  let processed = 0;
  while (true) {
    const { data } = await (sb as any)
      .from("pitch_log")
      .select("uniq_pitch_id, pitcher_id, pitch_type_reclassified, pitcher_hand, release_velocity, ivb, hb, spin, rel_height, rel_side, extension, stuff_plus, is_data")
      .eq("season", SEASON)
      .eq("is_data", true)
      .gt("uniq_pitch_id", lastId)
      .order("uniq_pitch_id")
      .limit(CHUNK);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const ptype = r.pitch_type_reclassified;
      const hand = r.pitcher_hand;
      if (!ptype || !RECLASS_TO_ENGINE[ptype]) continue;
      if (hand !== "L" && hand !== "R") continue;
      const k = `${r.pitcher_id}|${ptype}|${hand}`;
      let b = buckets.get(k);
      if (!b) {
        b = { pitcher_id: r.pitcher_id, pitch_type_reclassified: ptype, pitcher_hand: hand, n: 0, velocity: 0, ivb: 0, hb: 0, spin: 0, rel_height: 0, rel_side: 0, extension: 0, stuff_sum: 0, stuff_n: 0 };
        buckets.set(k, b);
      }
      if (r.release_velocity != null && r.ivb != null && r.hb != null && r.spin != null && r.rel_height != null && r.rel_side != null && r.extension != null) {
        b.n += 1;
        b.velocity += r.release_velocity;
        b.ivb += r.ivb;
        b.hb += r.hb;
        b.spin += r.spin;
        b.rel_height += r.rel_height;
        b.rel_side += r.rel_side;
        b.extension += r.extension;
      }
      if (r.stuff_plus != null) {
        b.stuff_sum += r.stuff_plus;
        b.stuff_n += 1;
      }
    }
    lastId = data[data.length - 1].uniq_pitch_id;
    processed += data.length;
    if (processed % 200_000 < CHUNK) console.log(`  scanned ${processed.toLocaleString()} pitches, ${buckets.size.toLocaleString()} buckets`);
  }
  console.log(`\nScanned ${processed.toLocaleString()} pitches, built ${buckets.size.toLocaleString()} (pitcher × pitch_type × hand) buckets`);

  // Score the average pitch in each bucket
  type Result = { pitcher_id: string; pitch_type: string; hand: "L" | "R"; n: number; per_pitch_avg: number | null; avg_pitch_score: number | null; diff: number | null };
  const results: Result[] = [];
  let skippedNoPop = 0;
  for (const b of buckets.values()) {
    if (b.n < MIN_PITCHES) continue;
    const enginePT = RECLASS_TO_ENGINE[b.pitch_type_reclassified];
    const pop = popMap.get(`${enginePT}::${b.pitcher_hand}`);
    if (!pop) { skippedNoPop++; continue; }
    const m = (v: number) => v / b.n;
    const row: PitchRow = {
      velocity: m(b.velocity), ivb: m(b.ivb), hb: m(b.hb), spin: m(b.spin),
      rel_height: m(b.rel_height), rel_side: m(b.rel_side), extension: m(b.extension),
      hand: b.pitcher_hand,
    } as PitchRow;
    const res = calculateStuffPlus(enginePT, row, pop);
    if (!res) continue;
    // No clamp on avg-pitch score (it represents the canonical profile)
    const avgPitchScore = res.score;
    const perPitchAvg = b.stuff_n > 0 ? b.stuff_sum / b.stuff_n : null;
    const diff = perPitchAvg != null ? perPitchAvg - avgPitchScore : null;
    results.push({ pitcher_id: b.pitcher_id, pitch_type: b.pitch_type_reclassified, hand: b.pitcher_hand, n: b.n, per_pitch_avg: perPitchAvg, avg_pitch_score: avgPitchScore, diff });
  }
  console.log(`Scored ${results.length} buckets (skipped ${skippedNoPop} with no pop constants)`);

  // Look up pitcher names
  const ids = [...new Set(results.map((r) => r.pitcher_id))];
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await (sb as any).from("players").select("source_player_id, first_name, last_name, team").in("source_player_id", ids.slice(i, i + 1000));
    for (const p of data ?? []) nameById.set(p.source_player_id, `${p.first_name} ${p.last_name} (${p.team ?? "—"})`);
  }

  // Top divergences
  const flagged = results.filter((r) => r.diff != null && Math.abs(r.diff!) >= FLAG_DIFF);
  flagged.sort((a, b) => Math.abs(b.diff!) - Math.abs(a.diff!));
  console.log(`\n${flagged.length} buckets flagged with |diff| ≥ ${FLAG_DIFF}\n`);
  console.log(`Top 50 divergences (per-pitch mean − avg-pitch profile):`);
  console.log("  PITCHER (TEAM)                             PITCH                 HAND   N    PER-PITCH   AVG-PITCH   DIFF");
  console.log("  " + "─".repeat(110));
  for (const r of flagged.slice(0, 50)) {
    const name = (nameById.get(r.pitcher_id) ?? `id=${r.pitcher_id}`).padEnd(40);
    console.log(`  ${name}   ${r.pitch_type.padEnd(20)}   ${r.hand}    ${r.n.toString().padStart(4)}   ${r.per_pitch_avg!.toFixed(1).padStart(8)}   ${r.avg_pitch_score.toFixed(1).padStart(9)}   ${(r.diff! > 0 ? "+" : "") + r.diff!.toFixed(1)}`);
  }
  console.log(`\n${flagged.length} flagged of ${results.length} scored (${((flagged.length / results.length) * 100).toFixed(1)}%)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
