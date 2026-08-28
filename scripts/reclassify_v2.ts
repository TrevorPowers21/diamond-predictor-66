/**
 * RECLASSIFY v2 — CLEAN-ROOM implementation of the RECOVERED design spec.
 * Built FROM the process (docs/STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md), NOT patched from the
 * empirical rebuild. This is the A2 committed anchor-reclassify foundation.
 *
 * Conventions (spec §0): armHB = (hand==R ? hb : −hb); gap = primaryFB_velo − pitch_velo; rr = ivb − |armHB|.
 * Classification is at the CLUSTER level per (pitcher × hand); per-pitch is only the SEED.
 *
 *   npx tsx --env-file .env.local scripts/reclassify_v2.ts --validate --sample 70
 */
import { createClient } from "@supabase/supabase-js";

const SEASON = 2026;
const args = process.argv;
const SAMPLE = Number(args[args.indexOf("--sample") + 1] ?? 70);
export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

// ─── §1  PER-PITCH BOUNDARY SEED (recovered CASE-evaluation order; order is load-bearing) ───
export function classifySeed(ivb: number, armhb: number, spin: number, gap: number): string {
  const rr = ivb - Math.abs(armhb);
  if (ivb <= -8 && armhb < 4 && gap >= 4) return "Curveball";                 // §1.1 topspin depth; refined gates (Check-3)
  if (armhb <= -12 && ivb > -8 && ivb <= 6) return "Sweeper";                 // §1.2 extreme glove sweep; armHB≤−12 DOMINATES (a −15 armHB IS a sweeper); ivb only excludes curve territory (≤−8, caught above)
  if (ivb >= 5 && gap >= 2 && gap <= 7 && armhb <= 2) return "Cutter";        // §1.3 cutter retains ride; +5 floor HELD; CORE gap 2-7 armHB≤2 (don't chase p95 tail — it bleeds into gyro/slider)
  if (gap < 4) return rr > 4 ? "4S FB" : rr < -4 ? "Sinker" : "FBSTRIP"; // §1.4 strip → FBSTRIP bucket (STAGE-2 resolved per-pitcher cluster; recovered from _reclass_map: FBSTRIP→4S 71% / Sinker 28%)
  if (Math.abs(armhb) < 5 && ivb >= -4 && ivb <= 4) return "Gyro Slider";     // §1.5 the bullet — 0 HB + neutral/NEGATIVE ivb (Trevor: "0 HB −6 IVB = gyro"; +7/0-HB = CUTTER not gyro). Blend tiebreaker extends gyro DOWN to −8, not up.
  if (armhb > 0) return spin < 1400 ? "Splitter" : "Change-up";               // §1.6 offspeed arm-side (velo-sep upstream)
  return "Slider";                                                            // §1.7 glove-side breaking residual
}

export const armHBof = (hb: number, hand: string) => (hand === "R" ? hb : -hb);
const BREAKING = ["Slider", "Sweeper", "Curveball", "Gyro Slider", "Cutter"];
const FAM = (b: string) => (["4S FB", "Sinker", "FBSTRIP"].includes(b) ? "FB" : ["Change-up", "Splitter"].includes(b) ? "OFF" : "BRK");
// FOLD family: FB (4S/Sinker/FBSTRIP) + OFF (Change/Splitter) cross-fold within family; every BREAKING ball is its OWN fold-family
// (a gyro is not a cutter — no gyro↔cutter↔slider cross-fold). Straddle-splits are already handled by the MERGE step.
const foldFam = (b: string) => (["4S FB", "Sinker", "FBSTRIP"].includes(b) ? "FB" : ["Change-up", "Splitter"].includes(b) ? "OFF" : b);

export interface P { uniq: string; raw: string; hand: string; velo: number; ivb: number; hb: number; spin: number | null; stored: string | null; }
interface Pt { p: P; iv: number; ar: number; ve: number; sp: number; gap: number; }
interface Cl { pts: Pt[]; iv: number; ar: number; ve: number; sp: number; gap: number; n: number; }
const mkCl = (pts: Pt[]): Cl => ({ pts, iv: mean(pts.map((x) => x.iv)), ar: mean(pts.map((x) => x.ar)), ve: mean(pts.map((x) => x.ve)), sp: mean(pts.map((x) => x.sp)), gap: mean(pts.map((x) => x.gap)), n: pts.length });

// ─── §3  tiebreakers, applied to a labeled cluster given the pitcher's arsenal context ───
function tiebreak(c: Cl, label: string, brkAnchorCount: number): string {
  // §3 gyro/curve blend strip: low-armHB, IVB∈(−8,−4) → depth-vs-bullet by velo gap
  if (Math.abs(c.ar) < 5 && c.iv > -8 && c.iv < -4) {
    return c.gap <= 8 ? "Gyro Slider" : c.gap >= 10 ? "Curveball" : label;
  }
  // §3 CT/SL arsenal: glove-side/neutral breaking in the 6–8 gap band around the measured valley of 7.
  // A/B 2026-08-28: ride-floor (IVB≥5→cutter) ONLY; arsenal-based slider→cutter conversion DISABLED (was over-firing).
  if ((label === "Slider" || label === "Cutter") && c.gap >= 6 && c.gap <= 8 && c.ar <= 2) {
    if (c.iv >= 5) return "Cutter";                 // ride floor breaks the tie first
    // return brkAnchorCount >= 2 ? "Cutter" : "Slider"; // arsenal conversion — DISABLED pending A/B
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

  // 3) LABEL each cluster by its MEAN (this is the FA/SI ±4 strip cluster-mean resolution)
  let labeled = clusters.map((c) => ({ c, label: classifySeed(c.iv, c.ar, c.sp, c.gap), review: false }));
  // STAGE 2 — FBSTRIP RESOLUTION (both small-sample + main paths): resolve strip cluster by its OWN mean rr
  // (recovered from _reclass_map: FBSTRIP→4S 71% / Sinker 28%; rr≥−1 fits the split — tune vs _reclass_result).
  for (const x of labeled) if (x.label === "FBSTRIP") { const rr = x.c.iv - Math.abs(x.c.ar); x.label = rr >= 0 ? "4S FB" : "Sinker"; }

  // §2.6 SMALL-SAMPLE FALLBACK (<150 pitches): global boundaries on cluster means only, no fold/tiebreak
  if (total < 150) {
    for (const x of labeled) for (const t of x.c.pts) out.set(t.p.uniq, { label: x.label, review: false });
    return out;
  }

  // 4) STEP-3 SEAM-LOCAL USAGE BACKFILL (Trevor 2026-08-28) — anchors = the pitcher's DOMINANT pitches (≥60p OR ≥10% of his mix).
  //    A non-anchor (borderline/unclear) cluster folds into the DOMINANT (highest-usage) anchor ONLY IF within a TIGHT movement+velo
  //    gate (genuinely the same pitch region / at a seam). Usage only breaks the tie WHEN MOVEMENT ALREADY CAN'T. A cluster far from
  //    ALL anchors is a genuinely distinct pitch → keep its own label + needs_review (a pitcher can throw 1 of any pitch in the sport).
  //    The TIGHT gate is the whole game: a −15 IVB cluster is ~15" from a gyro anchor → never folds into gyro no matter the gyro usage.
  const isAnchor = (c: Cl) => c.n >= 60 || c.n >= 0.10 * total;
  const anchors = labeled.filter((x) => isAnchor(x.c));
  const moveDist = (a: Cl, b: Cl) => Math.sqrt((a.iv - b.iv) ** 2 + (a.ar - b.ar) ** 2); // seam-local movement distance √(dIVB²+dHB²)
  const TIGHT = 5; // inches — the borderline band; beyond this the cluster is a genuinely distinct pitch, NOT a fold candidate
  for (const x of labeled) {
    // fold into a strictly-LARGER dominant pitch within the tight seam gate — handles both non-anchor residuals AND a small "anchor"
    // that is really a variant of a bigger pitch (design: "close candidate anchors merge into one"). Usage = pick the largest.
    const cands = anchors.filter((a) => a !== x && a.c.n > x.c.n && moveDist(a.c, x.c) < TIGHT && Math.abs(a.c.ve - x.c.ve) < 3);
    if (cands.length) x.label = cands.reduce((b, a) => (a.c.n > b.c.n ? a : b), cands[0]).label; // → the main pitch he throws
    else if (!isAnchor(x.c)) x.review = true; // non-anchor with no larger close pitch = distinct rare pitch → keep label + flag
  }

  // 5) TIEBREAKERS at the two ambiguous seams (needs the arsenal context)
  const brkAnchorCount = labeled.filter((x) => isAnchor(x.c) && BREAKING.includes(x.label)).length;
  for (const x of labeled) x.label = tiebreak(x.c, x.label, brkAnchorCount);

  for (const x of labeled) for (const t of x.c.pts) out.set(t.p.uniq, { label: x.label, review: x.review });
  return out;
}

// ─── validation harness (deterministic sample vs staging _reclass_result) ───
async function validate() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  // DETERMINISTIC + DIVERSE: spread-sample SAMPLE pitchers evenly across ALL 4804 (_reclass_pf) — avoids the
  // PostgREST 1000-row cap that collapsed prior runs to the same few high-volume arms.
  const allPitchers = [...pf.keys()].sort();
  const step = Math.max(1, Math.floor(allPitchers.length / SAMPLE));
  const uniq = allPitchers.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  let total = 0, match = 0, review = 0, mixNum = 0, mixDen = 0; const conf: Record<string, number> = {};
  const worst: { pid: string; mm: number; n: number; my: Record<string, number>; st: Record<string, number> }[] = [];
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
    const fbv = usable.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo);
    const labels = classifyPitcher(usable, pf.get(pid as string) ?? (fbv.length ? mean(fbv) : mean(usable.map((p) => p.velo))));
    const myC: Record<string, number> = {}, stC: Record<string, number> = {};
    for (const p of usable) { const got = labels.get(p.uniq); if (got == null) continue; total++; if (got.review) review++;
      myC[got.label] = (myC[got.label] ?? 0) + 1; stC[p.stored!] = (stC[p.stored!] ?? 0) + 1;
      if (got.label === p.stored) match++; else { const k = `${p.stored} → ${got.label}`; conf[k] = (conf[k] ?? 0) + 1; } }
    // pitcher-level ARSENAL-MIX overlap = Σ min(myCount, stagingCount) per type (borderline scatter within a type doesn't hurt)
    let over = 0; for (const t of new Set([...Object.keys(myC), ...Object.keys(stC)])) over += Math.min(myC[t] ?? 0, stC[t] ?? 0);
    mixNum += over; mixDen += usable.length; worst.push({ pid: pid as string, mm: usable.length - over, n: usable.length, my: myC, st: stC });
  }
  console.log(`\nRECLASSIFY v2 vs staging _reclass_result: ${match}/${total} = ${(100 * match / total).toFixed(1)}% per-pitch  |  ARSENAL-MIX overlap = ${(100 * mixNum / mixDen).toFixed(1)}%  (needs_review ${(100 * review / total).toFixed(1)}%)`);
  console.log("Top confusions (stored → predicted):");
  Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(`  ${n.toString().padStart(6)}  ${k}`));
  console.log("\nWorst arsenal-mix mismatches (pitcher: mismatch/total  mine  vs  staging):");
  const fmt = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace(/ (Slider|FB)/, "")}:${v}`).join(" ");
  worst.sort((a, b) => b.mm - a.mm).slice(0, 8).forEach((w) => console.log(`  ${w.pid.slice(-9)}: ${w.mm}/${w.n}   [${fmt(w.my)}]  vs  [${fmt(w.st)}]`));
}
// ─── DERIVE: read the real resolution boundaries off staging (cluster centroid → staging majority label) ───
async function derive() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  const allP = [...pf.keys()].sort(); const step = Math.max(1, Math.floor(allP.length / SAMPLE)); const uniq = allP.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  const out: { seed: string; hand: string; iv: number; ar: number; hb: number; ve: number; gap: number; rr: number; sp: number; n: number; stLabel: string; purity: number }[] = [];
  for (const pid of uniq) {
    const rows: P[] = []; let last = "";
    for (;;) { const { data } = await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified").eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
      if (!data || !data.length) break; for (const r of data) rows.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified }); last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break; }
    const usable = rows.filter((p) => p.velo != null && p.ivb != null && p.hb != null && p.stored != null); if (usable.length < 5) continue;
    const pfv = pf.get(pid as string) ?? mean(usable.map((p) => p.velo));
    const pts: Pt[] = usable.map((p) => ({ p, iv: p.ivb, ar: armHBof(p.hb, p.hand), ve: p.velo, sp: p.spin ?? 9999, gap: pfv - p.velo }));
    const bySeed = new Map<string, Pt[]>(); for (const t of pts) { const s = classifySeed(t.iv, t.ar, t.sp, t.gap); (bySeed.get(s) ?? bySeed.set(s, []).get(s)!).push(t); }
    let clusters = [...bySeed.values()].map(mkCl);
    for (;;) { let m = false; outer: for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const a = clusters[i], b = clusters[j]; if (Math.abs(a.ar - b.ar) < 4 && Math.abs(a.iv - b.iv) < 3.5 && Math.abs(a.ve - b.ve) < 2.5) { clusters[i] = mkCl([...a.pts, ...b.pts]); clusters.splice(j, 1); m = true; break outer; } } if (!m) break; }
    for (const c of clusters) {
      const stC: Record<string, number> = {}; for (const t of c.pts) stC[t.p.stored!] = (stC[t.p.stored!] ?? 0) + 1;
      const [stLabel, cnt] = Object.entries(stC).sort((a, b) => b[1] - a[1])[0];
      out.push({ seed: classifySeed(c.iv, c.ar, c.sp, c.gap), hand: c.pts[0].p.hand, iv: c.iv, ar: c.ar, hb: mean(c.pts.map((t) => t.p.hb)), ve: c.ve, gap: c.gap, rr: c.iv - Math.abs(c.ar), sp: c.sp, n: c.n, stLabel, purity: cnt / c.pts.length });
    }
  }
  const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const rng = (nm: string, xs: number[]) => `${nm}[${pct(xs, .05)?.toFixed(0)}·${pct(xs, .25)?.toFixed(0)}·${pct(xs, .5)?.toFixed(0)}·${pct(xs, .75)?.toFixed(0)}·${pct(xs, .95)?.toFixed(0)}]`;
  const byLH: Record<string, typeof out> = {}; for (const c of out) (byLH[`${c.stLabel}|${c.hand}`] ??= []).push(c);
  const labels = [...new Set(out.map((c) => c.stLabel))].sort((a, b) => out.filter((c) => c.stLabel === b).reduce((s, c) => s + c.n, 0) - out.filter((c) => c.stLabel === a).reduce((s, c) => s + c.n, 0));
  console.log(`\n=== per PITCH × HAND — cluster-centroid RANGES [p5·p25·p50·p75·p95]. (armHB normalized; raw hb shown to expose the hand flip) ===`);
  for (const lab of labels) for (const hand of ["R", "L"]) {
    const cs = byLH[`${lab}|${hand}`] ?? []; if (cs.length < 3) continue;
    console.log(`[${lab.padEnd(11)} ${hand}HP] ${String(cs.length).padStart(3)}cl/${String(cs.reduce((s, c) => s + c.n, 0)).padStart(5)}p  ${rng("rr", cs.map((c) => c.rr))} ${rng("armHB", cs.map((c) => c.ar))} ${rng("rawHB", cs.map((c) => c.hb))} ${rng("ivb", cs.map((c) => c.iv))} ${rng("gap", cs.map((c) => c.gap))} ${rng("spin", cs.map((c) => c.sp).filter((x) => x < 9999))} ${rng("velo", cs.map((c) => c.ve))}`);
  }
  // seed→staging label breakdown (which of MY seeds map to which staging labels = the overrides to learn)
  console.log(`\n=== MY-SEED → STAGING-label (cluster counts; overrides = off-diagonal) ===`);
  const bySeedLab: Record<string, Record<string, number>> = {};
  for (const c of out) { (bySeedLab[c.seed] ??= {}); bySeedLab[c.seed][c.stLabel] = (bySeedLab[c.seed][c.stLabel] ?? 0) + 1; }
  for (const [seed, m] of Object.entries(bySeedLab)) console.log(`  ${seed.padEnd(12)} → ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l.replace(/ (Slider|FB)/, "")}:${n}`).join("  ")}`);
}
// ─── MISMATCHES: find the ~10% of pitches that don't match staging, show if borderline (bleed) or real ───
async function mismatches() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  const allP = [...pf.keys()].sort(); const step = Math.max(1, Math.floor(allP.length / SAMPLE)); const uniq = allP.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  const miss: { pid: string; my: string; st: string; ar: number; iv: number; rr: number; gap: number; ve: number; sp: number }[] = [];
  let total = 0;
  for (const pid of uniq) {
    const rows: P[] = []; let last = "";
    for (;;) { const { data } = await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified").eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
      if (!data || !data.length) break; for (const r of data) rows.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified }); last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break; }
    const usable = rows.filter((p) => p.velo != null && p.ivb != null && p.hb != null && p.stored != null); if (usable.length < 5) continue;
    const fbv = usable.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo);
    const pfv = pf.get(pid as string) ?? (fbv.length ? mean(fbv) : mean(usable.map((p) => p.velo)));
    const labels = classifyPitcher(usable, pfv);
    for (const p of usable) { const g = labels.get(p.uniq); if (!g) continue; total++; if (g.label === p.stored) continue;
      const ar = armHBof(p.hb, p.hand); miss.push({ pid: pid as string, my: g.label, st: p.stored!, ar, iv: p.ivb, rr: p.ivb - Math.abs(ar), gap: pfv - p.velo, ve: p.velo, sp: p.spin ?? NaN }); }
  }
  const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  console.log(`\n${miss.length}/${total} mismatched (${(100 * miss.length / total).toFixed(1)}%). Per transition: the MISMATCHED pitches' movement [p25·p50·p75] — near a seam = bleed, far = real error:`);
  const byT: Record<string, typeof miss> = {}; for (const m of miss) (byT[`${m.st} → ${m.my}`] ??= []).push(m);
  for (const [t, ms] of Object.entries(byT).sort((a, b) => b[1].length - a[1].length).slice(0, 14))
    console.log(`  ${String(ms.length).padStart(5)}  ${t.padEnd(26)}  armHB[${pct(ms.map((m) => m.ar), .25).toFixed(0)}·${pct(ms.map((m) => m.ar), .5).toFixed(0)}·${pct(ms.map((m) => m.ar), .75).toFixed(0)}] ivb[${pct(ms.map((m) => m.iv), .25).toFixed(0)}·${pct(ms.map((m) => m.iv), .5).toFixed(0)}·${pct(ms.map((m) => m.iv), .75).toFixed(0)}] rr[${pct(ms.map((m) => m.rr), .25).toFixed(0)}·${pct(ms.map((m) => m.rr), .5).toFixed(0)}·${pct(ms.map((m) => m.rr), .75).toFixed(0)}] gap[${pct(ms.map((m) => m.gap), .5).toFixed(0)}]`);
  console.log(`\nWorst pitchers by mismatch count:`);
  const byP: Record<string, number> = {}; for (const m of miss) byP[m.pid] = (byP[m.pid] ?? 0) + 1;
  Object.entries(byP).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([p, n]) => console.log(`  ${p.slice(-9)}: ${n} mismatched`));
}
// ─── PITCHER: dump one pitcher's full repertoire — my clusters + labels vs staging's label WITHIN each cluster ───
async function pitcher() {
  const pidArg = args[args.indexOf("--pitcher") + 1];
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const { data: pfr } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").ilike("pitcher_id", `%${pidArg}`).limit(1);
  const pid = pfr?.[0]?.pitcher_id ?? pidArg;
  const rows: P[] = []; let last = "";
  for (;;) { const { data } = await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified").eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
    if (!data || !data.length) break; for (const r of data) rows.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified }); last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break; }
  const usable = rows.filter((p) => p.velo != null && p.ivb != null && p.hb != null && p.stored != null);
  const pfv = pfr?.[0]?.pf_velo ?? mean(usable.map((p) => p.velo));
  console.log(`\npitcher ${pid} (${usable[0]?.hand}HP, ${usable.length} pitches, primaryFB velo ${pfv?.toFixed(1)})`);
  // rebuild the clusters exactly as classifyPitcher does (seed+merge), then show my label + staging breakdown per cluster
  const pts: Pt[] = usable.map((p) => ({ p, iv: p.ivb, ar: armHBof(p.hb, p.hand), ve: p.velo, sp: p.spin ?? 9999, gap: pfv - p.velo }));
  const bySeed = new Map<string, Pt[]>(); for (const t of pts) { const s = classifySeed(t.iv, t.ar, t.sp, t.gap); (bySeed.get(s) ?? bySeed.set(s, []).get(s)!).push(t); }
  let clusters = [...bySeed.values()].map(mkCl);
  for (;;) { let m = false; outer: for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const a = clusters[i], b = clusters[j]; if (Math.abs(a.ar - b.ar) < 4 && Math.abs(a.iv - b.iv) < 3.5 && Math.abs(a.ve - b.ve) < 2.5) { clusters[i] = mkCl([...a.pts, ...b.pts]); clusters.splice(j, 1); m = true; break outer; } } if (!m) break; }
  const finalLabels = classifyPitcher(usable, pfv);
  console.log(`\nMY clusters (centroid → my FINAL label | staging label breakdown within cluster):`);
  for (const c of clusters.sort((a, b) => b.n - a.n)) {
    const myFinal = finalLabels.get(c.pts[0].p.uniq)?.label;
    const stC: Record<string, number> = {}; for (const t of c.pts) stC[t.p.stored!] = (stC[t.p.stored!] ?? 0) + 1;
    const stStr = Object.entries(stC).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(" ");
    console.log(`  n=${String(c.n).padStart(4)}  armHB=${c.ar.toFixed(1).padStart(5)} ivb=${c.iv.toFixed(1).padStart(5)} rr=${(c.iv - Math.abs(c.ar)).toFixed(1).padStart(5)} gap=${c.gap.toFixed(1).padStart(4)}  →  ${(myFinal ?? "?").padEnd(12)} | staging: ${stStr}`);
  }
  const myA: Record<string, number> = {}, stA: Record<string, number> = {};
  for (const p of usable) { const g = finalLabels.get(p.uniq)?.label; if (g) myA[g] = (myA[g] ?? 0) + 1; stA[p.stored!] = (stA[p.stored!] ?? 0) + 1; }
  console.log(`\nARSENAL  mine: ${Object.entries(myA).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(" ")}`);
  console.log(`      staging: ${Object.entries(stA).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(" ")}`);
}
// ─── STUFF+ SCORING (faithful copy of src/savant/lib/stuffPlusEngine.ts calc fns; row.hb = armHB) ───
type SRow = { velocity: number | null; ivb: number | null; hb: number | null; rel_height: number | null; rel_side: number | null; extension: number | null; spin: number | null; fb_ch_velo_diff: number | null };
type SPop = { velocity: number | null; velocity_sd: number | null; ivb: number | null; ivb_sd: number | null; hb: number | null; hb_sd: number | null; rel_height: number | null; rel_height_sd: number | null; rel_side: number | null; rel_side_sd: number | null; extension: number | null; extension_sd: number | null; spin: number | null; spin_sd: number | null; velo_diff: number | null; velo_diff_sd: number | null };
const zf = (p: number | null, a: number | null, s: number | null) => (p == null || a == null || s == null || s === 0 ? null : (p - a) / s);
const zAbsf = (p: number | null, a: number | null, s: number | null) => (p == null || a == null || s == null || s === 0 ? null : Math.abs(p - a) / s);
const zMaxf = (p: number | null, a: number | null, s: number | null) => (p == null || a == null || s == null || s === 0 ? null : (Math.max(p, a) - a) / s);
function scorePitch(pt: string, r: SRow, p: SPop): number | null {
  const zv = zf(r.velocity, p.velocity, p.velocity_sd) ?? 0, zvm = zMaxf(r.velocity, p.velocity, p.velocity_sd) ?? 0;
  const zi = zf(r.ivb, p.ivb, p.ivb_sd) ?? 0, zh = zf(r.hb, p.hb, p.hb_sd) ?? 0, zha = zAbsf(r.hb, p.hb, p.hb_sd) ?? 0;
  const zrh = zAbsf(r.rel_height, p.rel_height, p.rel_height_sd) ?? 0, zrs = zAbsf(r.rel_side, p.rel_side, p.rel_side_sd) ?? 0;
  const ze = zf(r.extension, p.extension, p.extension_sd) ?? 0, zsp = zf(r.spin, p.spin, p.spin_sd) ?? 0, zspa = zAbsf(r.spin, p.spin, p.spin_sd) ?? 0;
  const zg = zf(r.fb_ch_velo_diff, p.velo_diff, p.velo_diff_sd) ?? 0;
  let w = 0;
  switch (pt) {
    case "4S FB": w = 0.3 * zv + 0.25 * zi + 0.15 * zha + 0.1 * zrh + 0.05 * zrs + 0.1 * ze + 0.05 * zsp; break;
    case "Sinker": w = 0.3 * zv + (-0.2) * zi + 0.3 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze; break;
    case "Cutter": w = 0.3 * zvm + 0.15 * zi + (-0.25) * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zsp; break;
    case "Gyro Slider": { const zhg = (p.hb_sd && r.hb != null) ? (p.hb_sd - Math.abs(0 - r.hb)) / p.hb_sd : 0; w = 0.30 * zvm + 0.15 * (-zi) + 0.25 * zhg + 0.10 * zg + 0.05 * zrh + 0.05 * zrs + 0.10 * ze; break; }
    case "Slider": w = 0.15 * zvm + 0.1 * (-zi) + (-0.35) * zh + 0.10 * zg + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zsp; break;
    case "Sweeper": w = 0.1 * zvm + (-0.1) * zi + (-0.4) * zh + 0.10 * zg + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zsp; break;
    case "Curveball": w = 0.1 * zvm + (-0.3) * zi + (-0.15) * zh + 0.10 * zg + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.15 * zsp; break;
    case "Change-up": w = 0.15 * zg + (-0.2) * zi + 0.35 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.1 * zspa; break;
    case "Splitter": w = 0.1 * zvm + (-0.2) * zi + 0.25 * zh + 0.05 * zrh + 0.05 * zrs + 0.1 * ze + 0.25 * (-zsp); break;
    default: return null;
  }
  return 100 + w * 20;
}
async function stuffcheck() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  const pop = new Map<string, SPop>();
  { const { data } = await sb.from("pitcher_stuff_plus_ncaa").select("*").eq("season", SEASON); for (const r of data ?? []) pop.set(`${r.pitch_type}::${r.hand}`, r); }
  const allP = [...pf.keys()].sort(); const step = Math.max(1, Math.floor(allP.length / SAMPLE)); const uniq = allP.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  const perP: { pid: string; v2: number; st: number; n: number }[] = [];
  for (const pid of uniq) {
    const rows: (P & { rh: number | null; rs: number | null; ext: number | null })[] = []; let last = "";
    for (;;) { const { data } = await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,rel_height,rel_side,extension,pitch_type_reclassified").eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
      if (!data || !data.length) break; for (const r of data) rows.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified, rh: r.rel_height, rs: r.rel_side, ext: r.extension }); last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break; }
    const usable = rows.filter((p) => p.velo != null && p.ivb != null && p.hb != null && p.stored != null); if (usable.length < 5) continue;
    const fbv = usable.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo);
    const labels = classifyPitcher(usable, pf.get(pid as string) ?? (fbv.length ? mean(fbv) : mean(usable.map((p) => p.velo))));
    const hand = usable[0].hand;
    // aggregate per (label) under v2 + staging → mean movement (armHB) + count → score → pitch-weighted per-pitcher overall
    const agg = (getLbl: (p: typeof usable[0]) => string) => {
      const g: Record<string, typeof usable> = {}; for (const p of usable) { const l = getLbl(p); if (l) (g[l] ??= []).push(p); }
      let num = 0, den = 0;
      for (const [lbl, ps] of Object.entries(g)) {
        const pp = pop.get(`${lbl}::${hand}`); if (!pp) continue;
        const row: SRow = { velocity: mean(ps.map((p) => p.velo)), ivb: mean(ps.map((p) => p.ivb)), hb: mean(ps.map((p) => armHBof(p.hb, p.hand))), rel_height: mean(ps.map((p) => p.rh ?? NaN).filter((x) => !isNaN(x))) || null, rel_side: mean(ps.map((p) => p.rs ?? NaN).filter((x) => !isNaN(x))) || null, extension: mean(ps.map((p) => p.ext ?? NaN).filter((x) => !isNaN(x))) || null, spin: mean(ps.map((p) => p.spin ?? NaN).filter((x) => !isNaN(x))) || null, fb_ch_velo_diff: null };
        const s = scorePitch(lbl, row, pp); if (s == null) continue; num += s * ps.length; den += ps.length;
      }
      return den ? num / den : NaN;
    };
    const v2 = agg((p) => labels.get(p.uniq)?.label ?? ""), st = agg((p) => p.stored!);
    if (!isNaN(v2) && !isNaN(st)) perP.push({ pid: pid as string, v2, st, n: usable.length });
  }
  const deltas = perP.map((x) => x.v2 - x.st);
  const absd = deltas.map(Math.abs).sort((a, b) => a - b);
  const pctl = (q: number) => absd[Math.min(absd.length - 1, Math.floor(q * absd.length))];
  console.log(`\nSTUFF+ CROSS-CHECK — per-pitcher OVERALL Stuff+ (raw, pre-recenter), v2 labels vs staging labels, same equations+baselines.`);
  console.log(`${perP.length} pitchers. |Δ Stuff+| : mean=${(absd.reduce((a, b) => a + b, 0) / absd.length).toFixed(2)}  p50=${pctl(.5).toFixed(2)}  p90=${pctl(.9).toFixed(2)}  max=${absd[absd.length - 1].toFixed(2)}`);
  console.log(`within ±1: ${(100 * absd.filter((d) => d <= 1).length / absd.length).toFixed(0)}%   ±2: ${(100 * absd.filter((d) => d <= 2).length / absd.length).toFixed(0)}%   ±3: ${(100 * absd.filter((d) => d <= 3).length / absd.length).toFixed(0)}%`);
  console.log(`\nBiggest Stuff+ discrepancies (pitcher: v2 vs staging):`);
  perP.map((x) => ({ ...x, d: Math.abs(x.v2 - x.st) })).sort((a, b) => b.d - a.d).slice(0, 8).forEach((x) => console.log(`  ${x.pid.slice(-9)}: v2 ${x.v2.toFixed(1)}  staging ${x.st.toFixed(1)}  Δ ${(x.v2 - x.st).toFixed(1)}  (${x.n}p)`));
}
const __direct = !!process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (__direct && args.includes("--stuffcheck")) stuffcheck().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--pitcher")) pitcher().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--mismatches")) mismatches().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--derive")) derive().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--validate")) validate().catch((e) => { console.error(e); process.exit(1); });
else if (__direct) console.log("usage: --validate | --derive | --mismatches | --pitcher | --stuffcheck  [--sample N]");
