/**
 * STAGE-0 0.4 — DERIVE THE STUFF+ POP BASELINE (`pitcher_stuff_plus_ncaa`) FROM pitch_log. Chain step 2.
 *
 * WHY THIS EXISTS: every pre-existing writer of `pitcher_stuff_plus_ncaa` reads `pitcher_stuff_plus_inputs`
 * (nonBreakingBallPopConstants.ts, veloDiffPipeline.ts, legacy_breakingBallReclassification.ts) — the LEGACY lane,
 * which stores RAW hb. The LIVE lane scores pitch_log rows normalized to armHB. Re-deriving the baseline from PSP-I
 * would put the rows and the population on opposite HB conventions and score left-handers backwards.
 * VERIFIED 2026-08-29: PSP-I stores RAW hb (Change-up R +11.3 / L -10.9 — mirrored), while the CURRENT
 * pitcher_stuff_plus_ncaa is armHB-derived (Change-up R +14.93 / L +14.87 — same sign). So the live baseline never
 * came from PSP-I, and this producer reproduces it correctly: from pitch_log, in armHB.
 *
 * MANDATORY after any reclassification: the §4.5 gyro floor moves 6-8% of ALL breaking-ball volume, so every
 * mix-dependent mean/SD is invalid until regenerated. Chain: classify -> [THIS] -> score -> aggregate -> masters.
 *
 * pitch_log is D1-ONLY (verified: 5,303 pitchers, all D1), so no division filter is needed — but rows are tagged
 * division='D1' to match what the readers expect.
 *
 *   DRY RUN (default, read-only): npx tsx --env-file .env.local scripts/derive_stuff_plus_pop_baseline.ts
 *   APPLY (staging):              npx tsx --env-file .env.local scripts/derive_stuff_plus_pop_baseline.ts --apply
 *   APPLY (prod):                 npx tsx --env-file .env.production.local scripts/derive_stuff_plus_pop_baseline.ts --apply --prod
 */
import { createClient } from "@supabase/supabase-js";
import { armHBof } from "../src/savant/lib/stuffPlusClassifierV2.ts";

const SEASON = Number((process.argv.find((a) => a.startsWith("--season=")) || "").split("=")[1] || 2026);
const APPLY = process.argv.includes("--apply");
const PROD_FLAG = process.argv.includes("--prod");
const CLASS_VERSION = (process.argv.find((a) => a.startsWith("--class-version=")) || "").split("=")[1]
  || process.env.CLASS_VERSION || "v2-ranges-2026-08-28";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
// double-keyed env guard (same pattern as the rest of the chain)
const isProdUrl = /trbvxuoliwrfowibatkm/.test(url);
if (isProdUrl && !PROD_FLAG) { console.error("✗ URL is PROD but --prod was not passed — refusing."); process.exit(1); }
if (!isProdUrl && PROD_FLAG) { console.error("✗ --prod passed but URL is not prod — refusing."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } }) as any;

const TYPES = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const sd = (xs: number[], m: number) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length || 1));

type Acc = { velo: number[]; ivb: number[]; hb: number[]; rh: number[]; rs: number[]; ext: number[]; spin: number[]; gap: number[] };
const mk = (): Acc => ({ velo: [], ivb: [], hb: [], rh: [], rs: [], ext: [], spin: [], gap: [] });

async function main() {
  console.log(`derive pop baseline — env=${isProdUrl ? "PROD" : "STAGING"} season=${SEASON} class_version='${CLASS_VERSION}' mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // primary-FB velo per pitcher (for the fb_gap / velo_diff population term)
  const pf = new Map<string, number>();
  { let last = ""; for (;;) {
      const { data, error } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000);
      if (error) { console.error(`_reclass_pf: ${error.message} — run the reclassifier first (it materializes this table).`); process.exit(1); }
      if (!data || !data.length) break;
      for (const r of data) pf.set(String(r.pitcher_id), Number(r.pf_velo));
      last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  console.log(`  primary-FB velo for ${pf.size} pitchers`);

  // stream pitch_log_corrected, accumulate per (pitch_type × hand) in armHB
  const buckets = new Map<string, Acc>();
  let last = "", n = 0, skippedNoPf = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await sb.from("pitch_log_corrected")
      .select("uniq_pitch_id,pitcher_id,pitch_type_reclassified,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,rel_height,rel_side,extension")
      .eq("season", SEASON).eq("is_data", true).eq("classification_version", CLASS_VERSION)
      .gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
    if (error) { console.error(`pitch_log_corrected: ${error.message}`); process.exit(1); }
    if (!data || !data.length) break;
    for (const r of data) {
      const t = r.pitch_type_reclassified, h = r.pitcher_hand;
      if (!t || !h || !TYPES.includes(t)) continue;
      if (r.release_velocity == null || r.ivb_corrected == null || r.hb_corrected == null) continue;
      const k = `${t}::${h}`;
      const a = buckets.get(k) ?? (buckets.set(k, mk()), buckets.get(k)!);
      a.velo.push(r.release_velocity); a.ivb.push(r.ivb_corrected);
      a.hb.push(armHBof(r.hb_corrected, h));                       // ★ armHB — matches what the scorer feeds in
      if (r.rel_height != null) a.rh.push(r.rel_height);
      if (r.rel_side != null) a.rs.push(r.rel_side);
      if (r.extension != null) a.ext.push(r.extension);
      if (r.spin != null) a.spin.push(r.spin);
      const fbv = pf.get(String(r.pitcher_id));
      if (fbv != null) a.gap.push(fbv - r.release_velocity); else skippedNoPf++;
      n++;
    }
    last = data[data.length - 1].uniq_pitch_id;
    if (n % 250000 < 1000) console.log(`  ${n} pitches [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
    if (data.length < 1000) break;
  }
  if (!n) { console.error(`✗ 0 pitches matched classification_version='${CLASS_VERSION}'. Run the reclassifier FIRST.`); process.exit(1); }
  console.log(`  accumulated ${n} pitches into ${buckets.size} (pitch_type × hand) buckets (${skippedNoPf} lacked pf_velo)`);

  const rows = [...buckets.entries()].sort().map(([k, a]) => {
    const [pitch_type, hand] = k.split("::");
    const m = { velocity: mean(a.velo), ivb: mean(a.ivb), hb: mean(a.hb), rel_height: mean(a.rh), rel_side: mean(a.rs), extension: mean(a.ext), spin: mean(a.spin), velo_diff: mean(a.gap) };
    return {
      pitch_type, hand, season: SEASON, division: "D1",
      velocity: m.velocity, velocity_sd: sd(a.velo, m.velocity),
      ivb: m.ivb, ivb_sd: sd(a.ivb, m.ivb),
      hb: m.hb, hb_sd: sd(a.hb, m.hb),
      rel_height: m.rel_height, rel_height_sd: sd(a.rh, m.rel_height),
      rel_side: m.rel_side, rel_side_sd: sd(a.rs, m.rel_side),
      extension: m.extension, extension_sd: sd(a.ext, m.extension),
      spin: m.spin, spin_sd: sd(a.spin, m.spin),
      velo_diff: m.velo_diff, velo_diff_sd: sd(a.gap, m.velo_diff),
      _n: a.velo.length,
    };
  });

  console.log(`\npitch_type       hand      n     velo     ivb      hb   hb_sd     spin`);
  for (const r of rows) console.log(`  ${r.pitch_type.padEnd(13)} ${r.hand}  ${String(r._n).padStart(7)}  ${r.velocity.toFixed(1).padStart(5)}  ${r.ivb.toFixed(1).padStart(6)}  ${r.hb.toFixed(1).padStart(6)}  ${r.hb_sd.toFixed(2).padStart(5)}  ${r.spin.toFixed(0).padStart(5)}`);
  console.log(`\n★ SANITY: arm-side pitches (Change-up/Sinker) must be POSITIVE hb for BOTH hands (armHB), glove-side (Slider/Sweeper) NEGATIVE for both.`);
  const bad = rows.filter((r) => (["Change-up", "Sinker", "Splitter", "4S FB"].includes(r.pitch_type) && r.hb < 0) || (["Slider", "Sweeper", "Curveball"].includes(r.pitch_type) && r.hb > 0));
  if (bad.length) { console.error(`✗ SIGN CHECK FAILED on ${bad.length} bucket(s) — armHB convention is wrong, ABORTING: ${bad.map((b) => `${b.pitch_type}::${b.hand}=${b.hb.toFixed(1)}`).join(", ")}`); process.exit(1); }
  console.log(`  ✓ sign check passed on all ${rows.length} buckets`);

  if (!APPLY) { console.log(`\n=== DRY RUN — nothing written. Re-run with --apply to upsert ${rows.length} rows. ===`); return; }

  let ok = 0;
  for (const r of rows) {
    const { _n, ...payload } = r;
    const { error } = await sb.from("pitcher_stuff_plus_ncaa").upsert(payload, { onConflict: "pitch_type,hand,season" });
    if (error) console.error(`  ✗ ${r.pitch_type}::${r.hand}: ${error.message}`); else ok++;
  }
  console.log(`\n=== APPLIED — upserted ${ok}/${rows.length} pop buckets for season ${SEASON} ===`);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
