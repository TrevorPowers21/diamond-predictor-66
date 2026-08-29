/**
 * STUFF+ CLASSIFIER v2 — the committed forward pitch classifier (supersedes breakingBallReclassification v1).
 *
 * Pure logic, no I/O. Moved here from scripts/reclassify_v2.ts so the pipeline (src) owns it and scripts import it.
 * Validated 92.6% per-pitch / 93.0% arsenal-mix vs staging `_reclass_result` (2.0M pitch ground truth).
 * Every threshold in this file is recorded in docs/STUFF_PLUS_EXACT_VALUES.md — change them there too.
 *
 * Conventions: armHB = (hand==R ? hb : −hb); gap = primaryFB_velo − pitch_velo; rr = ivb − |armHB|.
 * Classification is at the CLUSTER level per (pitcher × hand); per-pitch is only the SEED.
 */

export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

export const armHBof = (hb: number, hand: string) => (hand === "R" ? hb : -hb);

// ─── §1  PER-PITCH BOUNDARY SEED (CASE-evaluation order is load-bearing) ───
export function classifySeed(ivb: number, armhb: number, spin: number, gap: number): string {
  const rr = ivb - Math.abs(armhb);
  if (ivb <= -8 && armhb < 4 && gap >= 4) return "Curveball";                 // §1.1 topspin depth
  if (armhb <= -12 && ivb > -8 && ivb <= 6) return "Sweeper";                 // §1.2 extreme glove sweep; armHB≤−12 dominates
  if (ivb >= 5 && gap >= 2 && gap <= 7 && armhb <= 2) return "Cutter";        // §1.3 cutter retains ride; CORE gap 2-7 (not the p95 tail)
  if (gap < 4) return rr > 4 ? "4S FB" : rr < -4 ? "Sinker" : "FBSTRIP";      // §1.4 FA/SI strip → resolved per-pitcher in §2
  if (Math.abs(armhb) < 5 && ivb >= -4 && ivb <= 4) return "Gyro Slider";     // §1.5 the bullet — 0 HB + neutral/NEGATIVE ivb
  if (armhb > 0) return spin < 1400 ? "Splitter" : "Change-up";               // §1.6 offspeed arm-side
  return "Slider";                                                            // §1.7 glove-side breaking residual
}

const BREAKING = ["Slider", "Sweeper", "Curveball", "Gyro Slider", "Cutter"];

export interface P { uniq: string; raw: string; hand: string; velo: number; ivb: number; hb: number; spin: number | null; stored: string | null; }
interface Pt { p: P; iv: number; ar: number; ve: number; sp: number; gap: number; }
interface Cl { pts: Pt[]; iv: number; ar: number; ve: number; sp: number; gap: number; n: number; }
const mkCl = (pts: Pt[]): Cl => ({ pts, iv: mean(pts.map((x) => x.iv)), ar: mean(pts.map((x) => x.ar)), ve: mean(pts.map((x) => x.ve)), sp: mean(pts.map((x) => x.sp)), gap: mean(pts.map((x) => x.gap)), n: pts.length });

// ─── §3  tiebreakers, applied to a labeled cluster given the pitcher's arsenal context ───
function tiebreak(c: Cl, label: string, _brkAnchorCount: number): string {
  // gyro/curve blend strip: low-armHB, IVB∈(−8,−4) → depth-vs-bullet by velo gap
  if (Math.abs(c.ar) < 5 && c.iv > -8 && c.iv < -4) {
    return c.gap <= 8 ? "Gyro Slider" : c.gap >= 10 ? "Curveball" : label;
  }
  // CT/SL: ride-floor only (IVB≥5→cutter); arsenal-based slider→cutter conversion DISABLED (over-fired in A/B).
  if ((label === "Slider" || label === "Cutter") && c.gap >= 6 && c.gap <= 8 && c.ar <= 2) {
    if (c.iv >= 5) return "Cutter";
  }
  return label;
}

// ─── §2  PER-PITCHER ALGORITHM ───
export function classifyPitcher(ps: P[], pfVelo: number): Map<string, { label: string; review: boolean }> {
  const out = new Map<string, { label: string; review: boolean }>();
  const total = ps.length;
  const pts: Pt[] = ps.map((p) => ({ p, iv: p.ivb, ar: armHBof(p.hb, p.hand), ve: p.velo, sp: p.spin ?? 9999, gap: pfVelo - p.velo }));

  // 1) boundary-seed → initial clusters
  const bySeed = new Map<string, Pt[]>();
  for (const t of pts) { const s = classifySeed(t.iv, t.ar, t.sp, t.gap); (bySeed.get(s) ?? bySeed.set(s, []).get(s)!).push(t); }
  let clusters: Cl[] = [...bySeed.values()].map(mkCl);

  // 2) MERGE seed-clusters split by a seam (Δarmhb<4 & Δivb<3.5 & Δvelo<2.5)
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

  // 3) LABEL each cluster by its MEAN, then resolve the FA/SI strip by the cluster's own mean rr
  const labeled = clusters.map((c) => ({ c, label: classifySeed(c.iv, c.ar, c.sp, c.gap), review: false }));
  for (const x of labeled) if (x.label === "FBSTRIP") { const rr = x.c.iv - Math.abs(x.c.ar); x.label = rr >= 0 ? "4S FB" : "Sinker"; }

  // §2.6 SMALL-SAMPLE FALLBACK (<150 pitches): cluster means only, no fold/tiebreak
  if (total < 150) {
    for (const x of labeled) for (const t of x.c.pts) out.set(t.p.uniq, { label: x.label, review: false });
    return out;
  }

  // 4) SEAM-LOCAL USAGE BACKFILL — anchors = dominant pitches (≥60p OR ≥10% of mix). A cluster folds into a
  //    strictly-LARGER anchor ONLY within a TIGHT movement+velo gate. Far from all anchors = genuinely distinct → needs_review.
  const isAnchor = (c: Cl) => c.n >= 60 || c.n >= 0.10 * total;
  const anchors = labeled.filter((x) => isAnchor(x.c));
  const moveDist = (a: Cl, b: Cl) => Math.sqrt((a.iv - b.iv) ** 2 + (a.ar - b.ar) ** 2);
  const TIGHT = 5; // inches
  for (const x of labeled) {
    const cands = anchors.filter((a) => a !== x && a.c.n > x.c.n && moveDist(a.c, x.c) < TIGHT && Math.abs(a.c.ve - x.c.ve) < 3);
    if (cands.length) x.label = cands.reduce((b, a) => (a.c.n > b.c.n ? a : b), cands[0]).label;
    else if (!isAnchor(x.c)) x.review = true;
  }

  // 5) TIEBREAKERS at the two ambiguous seams (needs arsenal context)
  const brkAnchorCount = labeled.filter((x) => isAnchor(x.c) && BREAKING.includes(x.label)).length;
  for (const x of labeled) x.label = tiebreak(x.c, x.label, brkAnchorCount);

  for (const x of labeled) for (const t of x.c.pts) out.set(t.p.uniq, { label: x.label, review: x.review });
  return out;
}

/** primaryFB velo = mean velo of the pitcher's raw fastball family (FA/SI, ≥3); fallback = all pitches. */
export function primaryFbVelo(ps: P[]): number {
  const fb = ps.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo);
  return fb.length >= 3 ? mean(fb) : mean(ps.map((p) => p.velo));
}
