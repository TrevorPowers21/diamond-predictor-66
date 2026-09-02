/**
 * FIT the recovered classifier's masked thresholds to staging's ground truth.
 * Pulls per-(pitcher × label × hand) SEED MEANS from staging (aggregated from pitch_log_corrected + _reclass_pf for gap),
 * then coordinate-descends each threshold to maximize seed-level agreement (weighted by pitch count) with staging's label.
 *   npx tsx --env-file .env.local scripts/_reclass_fit.ts
 */
import { createClient } from "@supabase/supabase-js";
const url = process.env.VITE_SUPABASE_URL || "";
if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;

interface Seed { lab: string; n: number; ivb: number; armhb: number; spin: number; gap: number; }

// classifier structure (recovered); T = the thresholds we're solving for
function classify(ivb: number, armhb: number, spin: number, gap: number, T: any): string {
  if (ivb <= T.curveIvb) return "Curveball";
  if (ivb >= T.sweepIvbMin && armhb <= T.sweepArm && gap >= T.sweepGapLo && gap <= T.sweepGapHi) return "Sweeper";
  if (gap < T.fbGap && ivb - Math.abs(armhb) > T.fs4s) return "4S FB";
  if (gap < T.fbGap && ivb - Math.abs(armhb) < T.fsSinker) return "Sinker";
  if (gap < T.fbGap) return "Cutter";
  if (armhb > T.splitArm && spin < T.splitSpin) return "Splitter";
  if (armhb > T.changeArm) return "Change-up";
  if (armhb <= T.sliderArm) return "Slider";
  if (Math.abs(armhb) < T.gyroArm && ivb >= T.gyroIvbLo && ivb <= T.gyroIvbHi) return "Gyro Slider";
  return "Slider";
}

(async () => {
  // materialize seed means (gap folded in via _reclass_pf) into a table server-side (survives gateway cut)
  try {
    await sb.rpc("exec_sql", { sql: `set local statement_timeout='170s'; drop table if exists _seed_agg;
      create table _seed_agg as
      select pl.pitcher_id pid, pl.pitch_type_reclassified lab, count(*) n,
        avg(pl.ivb_corrected)::float8 ivb,
        avg(case when pl.pitcher_hand='R' then pl.hb_corrected else -pl.hb_corrected end)::float8 armhb,
        avg(coalesce(pl.spin,9999))::float8 spin,
        (coalesce(max(pf.pf_velo), avg(pl.release_velocity)) - avg(pl.release_velocity))::float8 gap
      from pitch_log_corrected pl
      left join _reclass_pf pf on pf.pitcher_id = pl.pitcher_id
      where pl.season=2026 and pl.pitch_type_reclassified is not null and pl.ivb_corrected is not null and pl.hb_corrected is not null
      group by pl.pitcher_id, pl.pitch_type_reclassified, pl.pitcher_hand;` });
  } catch (e: any) { console.log("(create _seed_agg call returned:", e?.message, "— may have committed server-side; verifying)"); }
  await new Promise((r) => setTimeout(r, 8000));
  await sb.rpc("exec_sql", { sql: "NOTIFY pgrst,'reload schema';" }); await new Promise((r) => setTimeout(r, 2500));
  // page the seed table out
  const seeds: Seed[] = []; let off = 0;
  for (;;) {
    const { data, error } = await sb.from("_seed_agg").select("lab,n,ivb,armhb,spin,gap").range(off, off + 999);
    if (error) { console.error("read _seed_agg:", error.message); break; }
    if (!data || !data.length) break;
    for (const r of data) seeds.push({ lab: r.lab, n: r.n, ivb: r.ivb, armhb: r.armhb, spin: r.spin, gap: r.gap });
    off += data.length; if (data.length < 1000) break;
  }
  if (!seeds.length) { console.error("no seeds (aggregation may still be running)"); process.exit(1); }
  console.log(`seeds: ${seeds.length}, pitches covered: ${seeds.reduce((s, x) => s + x.n, 0)}`);

  const T: any = { curveIvb: -8, sweepIvbMin: -2, sweepArm: -10, sweepGapLo: 8, sweepGapHi: 13, fbGap: 4, fs4s: 1, fsSinker: -1, splitSpin: 1400, splitArm: 4, changeArm: 4, sliderArm: -6, gyroArm: 6, gyroIvbLo: -8, gyroIvbHi: 6 };
  const score = (t: any) => seeds.reduce((s, x) => s + (classify(x.ivb, x.armhb, x.spin, x.gap, t) === x.lab ? x.n : 0), 0);
  const totalN = seeds.reduce((s, x) => s + x.n, 0);
  // coordinate descent — each threshold scanned over a range at 0.25 steps (spin at 25)
  const ranges: Record<string, [number, number, number]> = {
    curveIvb: [-12, -4, 0.25], sweepIvbMin: [-6, 2, 0.25], sweepArm: [-16, -6, 0.25], sweepGapLo: [4, 11, 0.25], sweepGapHi: [10, 18, 0.25],
    fbGap: [1.5, 7, 0.25], fs4s: [-3, 6, 0.25], fsSinker: [-6, 3, 0.25], splitSpin: [1000, 1800, 25], splitArm: [-2, 8, 0.25], changeArm: [-2, 8, 0.25],
    sliderArm: [-12, -1, 0.25], gyroArm: [2, 9, 0.25], gyroIvbLo: [-10, 0, 0.25], gyroIvbHi: [0, 10, 0.25],
  };
  console.log(`start: ${(100 * score(T) / totalN).toFixed(1)}%`);
  for (let round = 0; round < 4; round++) {
    for (const k of Object.keys(ranges)) {
      const [lo, hi, step] = ranges[k]; let best = T[k], bestS = score(T);
      for (let v = lo; v <= hi; v += step) { T[k] = v; const s = score(T); if (s > bestS) { bestS = s; best = Math.round(v * 100) / 100; } }
      T[k] = best;
    }
    console.log(`round ${round + 1}: ${(100 * score(T) / totalN).toFixed(1)}%`);
  }
  console.log("\nFITTED THRESHOLDS:");
  console.log(JSON.stringify(T, null, 0));
})().catch((e) => { console.error(e); process.exit(1); });
