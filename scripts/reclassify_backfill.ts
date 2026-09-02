/**
 * RECLASSIFICATION BACKFILL — 2026-08-28.
 * Classifier structure RECOVERED from staging pg_stat_statements (the in-DB "classifier v2"): one unified CASE on
 * ivb_corrected, armHB (=hand=R?hb:−hb), gap (=pf_velo−velo), spin. Thresholds masked in the history ($N) → taken from
 * THE PARTITION spec, confirmed/adjusted against staging `_reclass_result` (the 2M ground-truth labels).
 * Per-pitch classify → per-pitcher anchor-gravity override (≥60p OR ≥10% mix; sub-bar folds into nearest anchor by
 * movementDistance √(dIVB²+dHB²) + family guard). Each pitch → its cluster's final label.
 *
 *   npx tsx --env-file .env.local scripts/reclassify_backfill.ts --validate --sample 80
 */
import { createClient } from "@supabase/supabase-js";

const SEASON = 2026;
const args = process.argv;
const SAMPLE = Number(args[args.indexOf("--sample") + 1] ?? 80);

const movementDistance = (aI: number, aH: number, bI: number, bH: number) => Math.sqrt((aI - bI) ** 2 + (aH - bH) ** 2);

// ★ RECOVERED classifier (order + features verbatim from the query history). Thresholds from THE PARTITION spec.
// EXACT documented numbers (THE PARTITION spec — HANDOFF_STUFF_PLUS)
const T = {
  curveIvb: -8,
  sweepIvbMin: -2, sweepArm: -12, sweepGapLo: 8, sweepGapHi: 13,
  fbGap: 4, fs4s: 4, fsSinker: -4,
  splitSpin: 1400, splitArm: 0, changeArm: 0, sliderArm: -5,
  gyroArm: 5, gyroIvbLo: -4, gyroIvbHi: 4,
};
// EXACT documented v2 boundaries (HANDOFF_STUFF_PLUS line 51-53):
function classifyPitch(ivb: number, armhb: number, spin: number, gap: number): string {
  const rr = ivb - Math.abs(armhb);
  if (ivb <= -8 && armhb < 4 && gap >= 4) return "Curveball";              // curve: IVB≤−8 (CB refinement armHB<4 & gap≥4)
  if (armhb <= -12) return "Sweeper";                                       // sweeper: armHB≤−12 cliff (DERIVED from _reclass_result: armHB<−12 = 98% SW, ≥−12 = 3%); NO ivb gate — Sweepers span ivb −7..+7
  if (ivb >= 5 && gap >= 2 && gap <= 7 && armhb <= 2) return "Cutter";     // ★ cutter: GLOVE-side, IVB≥+5, gap∈[2,7] (+5 floor HELD)
  if (gap < 4) return rr > 4 ? "4S FB" : rr < -4 ? "Sinker" : rr >= 0 ? "4S FB" : "Sinker"; // fastball; ±4, middle by sign (cluster-mean resolves)
  if (Math.abs(armhb) < 5 && ivb >= -4 && ivb <= 4) return "Gyro Slider";  // gyro: |armHB|<5 & IVB∈[−4,4] (BEFORE offspeed — low-HB bullet)
  if (armhb > 0) return spin < 1400 ? "Splitter" : "Change-up";           // offspeed (arm-side): split spin<1400 else change
  return "Slider";                                                         // glove-side breaking, ivb<5
}
const armHBof = (hb: number, hand: string) => (hand === "R" ? hb : -hb);
const FAM = (b: string) => (["4S FB", "Sinker"].includes(b) ? "FB" : ["Change-up", "Splitter"].includes(b) ? "OFF" : "BRK");
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

interface P { uniq: string; raw: string; hand: string; velo: number; ivb: number; hb: number; spin: number | null; stored: string | null; }

/** primary FB velo = mean velo of the pitcher's fastball-family (raw FA/SI), fallback all pitches. */
function pfbVelo(ps: P[]): number {
  const fb = ps.filter((p) => p.raw === "FA" || p.raw === "SI");
  return mean((fb.length >= 3 ? fb : ps).map((p) => p.velo));
}

/** DEPLOYED algorithm (HANDOFF_STUFF_PLUS §"REBUILT to the locked design"): boundary-seed each pitch → agglomeratively
 * MERGE a pitcher's seed-clusters within (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5) → label each merged cluster by its MEAN vs the
 * boundaries → anchor fold (≥60p OR ≥10% mix; residuals fold to nearest same-family anchor by multivariate proximity). */
interface Pt { p: P; iv: number; ar: number; ve: number; sp: number; }
interface Cl { pts: Pt[]; iv: number; ar: number; ve: number; sp: number; n: number; }
const mkCl = (pts: Pt[]): Cl => ({ pts, iv: mean(pts.map((x) => x.iv)), ar: mean(pts.map((x) => x.ar)), ve: mean(pts.map((x) => x.ve)), sp: mean(pts.map((x) => x.sp)), n: pts.length });
function classifyPitcher(ps: P[], pfOverride?: number): Map<string, string> {
  const out = new Map<string, string>();
  const pfb = pfOverride ?? pfbVelo(ps), total = ps.length;
  const pts: Pt[] = ps.map((p) => ({ p, iv: p.ivb, ar: armHBof(p.hb, p.hand), ve: p.velo, sp: p.spin ?? 9999 }));
  // 1) boundary-seed each pitch → 2) initial clusters
  const bySeed = new Map<string, Pt[]>();
  for (const t of pts) { const s = classifyPitch(t.iv, t.ar, t.sp, pfb - t.ve); (bySeed.get(s) ?? bySeed.set(s, []).get(s)!).push(t); }
  let clusters: Cl[] = [...bySeed.values()].map(mkCl);
  // 3) agglomerative merge: seams (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5)
  for (;;) {
    let merged = false;
    outer: for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j];
      if (Math.abs(a.ar - b.ar) < 4 && Math.abs(a.iv - b.iv) < 3.5 && Math.abs(a.ve - b.ve) < 2.5) {
        clusters[i] = mkCl([...a.pts, ...b.pts]); clusters.splice(j, 1); merged = true; break outer;
      }
    }
    if (!merged) break;
  }
  // 4) label each merged cluster by its MEAN
  const labeled = clusters.map((c) => ({ c, label: classifyPitch(c.iv, c.ar, c.sp, pfb - c.ve) }));
  // 5a) GYRO/CURVE BLEND-STRIP TIEBREAKER (recovered spec §3): a low-armHB cluster in the IVB∈[−8,−4] blend
  //     strip is depth-vs-bullet decided by velo gap, not movement. gap≤8→Gyro, gap≥10→Curve (hard bounds
  //     already handled by classifyPitch: IVB≤−8→Curve, IVB∈[−4,4]→Gyro). Rescues −6-IVB gyros from Slider.
  for (const x of labeled) {
    if (Math.abs(x.c.ar) < 5 && x.c.iv > -8 && x.c.iv < -4) {
      const gap = pfb - x.c.ve;
      x.label = gap <= 8 ? "Gyro Slider" : gap >= 10 ? "Curveball" : x.label;
    }
  }
  // 5) anchor fold — residuals fold into nearest same-family anchor by multivariate proximity (velo-gap guard)
  const isAnchor = (c: Cl) => c.n >= 60 || c.n >= 0.10 * total;
  let anchors = labeled.filter((x) => isAnchor(x.c));
  if (!anchors.length) anchors = labeled;
  const dist = (a: Cl, b: Cl) => Math.abs(a.iv - b.iv) + Math.abs(a.ar - b.ar) + Math.abs(a.ve - b.ve);
  for (const x of labeled) {
    let label = x.label;
    if (!isAnchor(x.c)) {
      const same = anchors.filter((a) => FAM(a.label) === FAM(x.label) && a !== x);
      const cand = same.length ? same : anchors.filter((a) => a !== x);
      if (cand.length) label = cand.reduce((bst, a) => (dist(x.c, a.c) < dist(x.c, bst.c) ? a : bst), cand[0]).label;
    }
    for (const t of x.c.pts) out.set(t.p.uniq, label);
  }
  return out;
}

async function validate() {
  const url = process.env.VITE_SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  // exact stored primary-FB velo per pitcher
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  // DETERMINISTIC sample: order by pitcher_id so the SAME set of pitchers is used every run (deltas are real, not sample noise)
  const { data: pl } = await sb.from("pitch_log").select("pitcher_id").eq("season", SEASON).not("pitch_type_reclassified", "is", null).order("pitcher_id").limit(40000);
  const uniq = [...new Set((pl ?? []).map((r: any) => r.pitcher_id))].slice(0, SAMPLE);
  let total = 0, match = 0; const conf: Record<string, number> = {};
  for (const pid of uniq) {
    const rows: P[] = []; let last = "";
    for (;;) {
      const { data } = await sb.from("pitch_log_corrected")
        .select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified")
        .eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
      if (!data || !data.length) break;
      for (const r of data) rows.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified });
      last = data[data.length - 1].uniq_pitch_id;
      if (data.length < 1000) break;
    }
    const usable = rows.filter((p) => p.velo != null && p.ivb != null && p.hb != null && p.stored != null);
    if (usable.length < 5) continue;
    const labels = classifyPitcher(usable, pf.get(pid as string));
    for (const p of usable) { const got = labels.get(p.uniq); if (got == null) continue; total++; if (got === p.stored) match++; else { const k = `${p.stored} → ${got}`; conf[k] = (conf[k] ?? 0) + 1; } }
  }
  console.log(`\nBACKFILL vs staging _reclass_result: ${match}/${total} = ${(100 * match / total).toFixed(1)}%`);
  console.log("Top confusions (stored → predicted):");
  Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(`  ${n.toString().padStart(6)}  ${k}`));
}
if (args.includes("--validate")) validate().catch((e) => { console.error(e); process.exit(1); });
else console.log("usage: --validate --sample N");
