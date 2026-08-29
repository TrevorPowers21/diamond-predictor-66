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
// ★ SINGLE SOURCE OF TRUTH: the classifier lives in src/savant/lib/stuffPlusClassifierV2.ts.
// This script is now only the validation/analysis harness — it must NEVER carry its own copy of the
// classifier logic (that duplication is what let the two drift apart on 2026-08-29).
export { mean, armHBof, classifySeed, classifyPitcher, primaryFbVelo, type P } from "../src/savant/lib/stuffPlusClassifierV2.ts";
import { mean, armHBof, classifySeed, classifyPitcher, type P } from "../src/savant/lib/stuffPlusClassifierV2.ts";

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
// ─── SCORE: the per-row Stuff+ calculation (classify v2 → aggregate per label×hand → score by label → RECENTER per bucket → per-pitcher rollup). READ-ONLY compute, no writes. ───
async function scoreAll() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const env = /trbvxuoliwrfowibatkm/.test(url) ? "PROD" : /slrxowawbijbjrkozqlj/.test(url) ? "STAGING" : "?";
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  console.log(`per-row Stuff+ calc — env=${env} (READ-ONLY compute, no writes)`);
  const pf = new Map<string, number>();
  { let last = ""; for (;;) { const { data } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000); if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } }
  const pop = new Map<string, SPop>();
  { const { data } = await sb.from("pitcher_stuff_plus_ncaa").select("*").eq("season", SEASON); for (const r of data ?? []) pop.set(`${r.pitch_type}::${r.hand}`, r); }
  let pitchers = [...pf.keys()].sort();
  if (args.includes("--sample")) { const step = Math.max(1, Math.floor(pitchers.length / SAMPLE)); pitchers = pitchers.filter((_, i) => i % step === 0).slice(0, SAMPLE); }
  console.log(`scoring ${pitchers.length} pitchers over ${pop.size} (type×hand) baselines...`);
  const rows: { pid: string; lbl: string; hand: string; n: number; raw: number }[] = []; let done = 0, skipped = 0, reviewPitches = 0, allPitches = 0;
  for (const pid of pitchers) {
    const pr: (P & { rh: number | null; rs: number | null; ext: number | null })[] = []; let last = "";
    for (;;) { const { data } = await sb.from("pitch_log_corrected").select("uniq_pitch_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,rel_height,rel_side,extension,pitch_type_reclassified").eq("pitcher_id", pid).eq("season", SEASON).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
      if (!data || !data.length) break; for (const r of data) pr.push({ uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified, rh: r.rel_height, rs: r.rel_side, ext: r.extension }); last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break; }
    const usable = pr.filter((p) => p.velo != null && p.ivb != null && p.hb != null); if (usable.length < 1) { skipped++; continue; }
    const fbv = usable.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo);
    const labels = classifyPitcher(usable, pf.get(pid) ?? (fbv.length ? mean(fbv) : mean(usable.map((p) => p.velo))));
    const hand = usable[0].hand;
    for (const p of usable) { allPitches++; if (labels.get(p.uniq)?.review) reviewPitches++; }
    const g: Record<string, typeof usable> = {}; for (const p of usable) { const l = labels.get(p.uniq)?.label; if (l) (g[l] ??= []).push(p); }
    for (const [lbl, ps] of Object.entries(g)) {
      const pp = pop.get(`${lbl}::${hand}`); if (!pp) continue;
      const row: SRow = { velocity: mean(ps.map((p) => p.velo)), ivb: mean(ps.map((p) => p.ivb)), hb: mean(ps.map((p) => armHBof(p.hb, p.hand))), rel_height: mean(ps.map((p) => p.rh ?? NaN).filter((x) => !isNaN(x))) || null, rel_side: mean(ps.map((p) => p.rs ?? NaN).filter((x) => !isNaN(x))) || null, extension: mean(ps.map((p) => p.ext ?? NaN).filter((x) => !isNaN(x))) || null, spin: mean(ps.map((p) => p.spin ?? NaN).filter((x) => !isNaN(x))) || null, fb_ch_velo_diff: null };
      const s = scorePitch(lbl, row, pp); if (s == null) continue;
      rows.push({ pid, lbl, hand, n: ps.length, raw: s });
    }
    if (++done % 500 === 0) console.log(`  ${done}/${pitchers.length} pitchers, ${rows.length} rows`);
  }
  // RECENTER each (pitch_type × hand) bucket to mean 100 (pitch-weighted)
  const buck: Record<string, { sum: number; n: number }> = {}; for (const r of rows) { const k = `${r.lbl}::${r.hand}`; (buck[k] ??= { sum: 0, n: 0 }); buck[k].sum += r.raw * r.n; buck[k].n += r.n; }
  const shift: Record<string, number> = {}; for (const [k, b] of Object.entries(buck)) shift[k] = b.sum / b.n - 100;
  for (const r of rows) r.raw = Math.round((r.raw - shift[`${r.lbl}::${r.hand}`]) * 10) / 10;
  // per-pitcher overall (pitch-weighted mean of recentered row scores)
  const byP: Record<string, { sum: number; n: number }> = {}; for (const r of rows) { (byP[r.pid] ??= { sum: 0, n: 0 }); byP[r.pid].sum += r.raw * r.n; byP[r.pid].n += r.n; }
  const overalls = Object.values(byP).map((b) => b.sum / b.n).sort((a, b) => a - b);
  const q = (x: number) => overalls[Math.min(overalls.length - 1, Math.floor(x * overalls.length))];
  console.log(`\n=== PER-ROW STUFF+ CALC complete (${env}, READ-ONLY) — ${rows.length} scored rows / ${Object.keys(byP).length} pitchers / ${allPitches} pitches; ${skipped} pitchers skipped; needs_review ${(100 * reviewPitches / allPitches).toFixed(1)}% (per-pitch) ===`);
  console.log(`\nper-(type×hand) RAW bucket offset from 100 (recenter shifts each to exactly 100.0):`);
  for (const [k, b] of Object.entries(buck).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(20)} raw=${(b.sum / b.n).toFixed(1)} pitch-n=${b.n}`);
  console.log(`\nper-pitcher OVERALL Stuff+ distribution: p10=${q(.1).toFixed(1)} p25=${q(.25).toFixed(1)} p50=${q(.5).toFixed(1)} p75=${q(.75).toFixed(1)} p90=${q(.9).toFixed(1)}  mean=${(overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1)}`);
}
// ─── VS-STAGING: engine-fidelity — reproduce staging's EXACT pipeline on staging's OWN pitcher_stuff_plus_inputs rows
// (same inputs, same equations, same per-pitcher-unweighted recenter + rounding) and compare to the STORED stuff_plus. ───
async function vsstaging() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
  const pop = new Map<string, SPop>();
  { const { data } = await sb.from("pitcher_stuff_plus_ncaa").select("*").eq("season", SEASON); for (const r of data ?? []) pop.set(`${r.pitch_type}::${r.hand}`, r); }
  const TYPES = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];
  type IR = { pt: string; hand: string; pitches: number; velocity: number; ivb: number; hb: number; rh: number; rs: number; ext: number; spin: number; fbch: number; stored: number | null };
  const rows: IR[] = []; let last: any = null;
  for (;;) {
    let qy = sb.from("pitcher_stuff_plus_inputs").select("id,pitch_type,hand,pitches,velocity,ivb,hb,rel_height,rel_side,extension,spin,fb_ch_velo_diff,stuff_plus").eq("season", SEASON).in("pitch_type", TYPES).order("id").limit(1000);
    if (last !== null) qy = qy.gt("id", last);
    const { data, error } = await qy; if (error) { console.error(error.message); process.exit(1); }
    if (!data || !data.length) break;
    for (const r of data) rows.push({ pt: r.pitch_type, hand: r.hand, pitches: r.pitches, velocity: r.velocity, ivb: r.ivb, hb: r.hb, rh: r.rel_height, rs: r.rel_side, ext: r.extension, spin: r.spin, fbch: r.fb_ch_velo_diff, stored: r.stuff_plus });
    last = data[data.length - 1].id; if (data.length < 1000) break;
  }
  const scored: { key: string; raw: number; outlier: boolean; stored: number | null }[] = []; let drop = 0;
  for (const r of rows) {
    if (r.ivb == null || r.hb == null) { drop++; continue; }
    if (r.ivb === 0 && r.hb === 0 && (r.pitches ?? 0) < 5) { drop++; continue; }
    if ((r.pitches ?? 0) < 5) { drop++; continue; }
    const pp = pop.get(`${r.pt}::${r.hand}`); if (!pp) { drop++; continue; }
    const hbUse = (process.env.FLIP_L === "1" && r.hand === "L") ? -r.hb : r.hb;  // diagnostic: test raw-hb vs armHB on LHP
    const s0 = scorePitch(r.pt, { velocity: r.velocity, ivb: r.ivb, hb: hbUse, rel_height: r.rh, rel_side: r.rs, extension: r.ext, spin: r.spin, fb_ch_velo_diff: r.fbch }, pp);
    if (s0 == null) { drop++; continue; }
    const raw = Math.round(s0 * 10) / 10;
    scored.push({ key: `${r.pt}::${r.hand}`, raw, outlier: raw > 140 || raw < 60, stored: r.stored });
  }
  const calib: Record<string, { sum: number; count: number }> = {};
  for (const s of scored) { if (s.outlier) continue; (calib[s.key] ??= { sum: 0, count: 0 }); calib[s.key].sum += s.raw; calib[s.key].count += 1; }
  const shift: Record<string, number> = {}; for (const [k, b] of Object.entries(calib)) if (b.count) shift[k] = b.sum / b.count - 100;
  const deltas: number[] = []; let matched = 0, cmp = 0; const worst: { key: string; raw: number; rec: number; stored: number; d: number }[] = [];
  const perBucket: Record<string, { n: number; ok: number; sd: number }> = {};
  for (const s of scored) {
    const sh = shift[s.key]; if (sh == null || s.stored == null) continue;
    const rec = Math.round((s.raw - sh) * 10) / 10; const d = Math.abs(rec - s.stored);
    deltas.push(d); cmp++; if (d < 0.05) matched++; if (d >= 0.05) worst.push({ key: s.key, raw: s.raw, rec, stored: s.stored, d });
    (perBucket[s.key] ??= { n: 0, ok: 0, sd: 0 }); perBucket[s.key].n++; if (d < 0.5) perBucket[s.key].ok++; perBucket[s.key].sd += d;
  }
  deltas.sort((a, b) => a - b); const q = (x: number) => deltas[Math.min(deltas.length - 1, Math.floor(x * deltas.length))];
  console.log(`\nENGINE-FIDELITY — our scoring vs staging STORED pitcher_stuff_plus_inputs.stuff_plus (identical inputs, labels, recenter).`);
  console.log(`rows ${rows.length}, scored ${scored.length}, dropped ${drop}, compared ${cmp}`);
  console.log(`EXACT match (|Δ|<0.05): ${matched}/${cmp} = ${(100 * matched / cmp).toFixed(1)}%`);
  console.log(`|Δ| mean=${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(3)}  p50=${q(.5).toFixed(2)}  p90=${q(.9).toFixed(2)}  p99=${q(.99).toFixed(2)}  max=${deltas[deltas.length - 1].toFixed(2)}`);
  console.log(`within ±0.5: ${(100 * deltas.filter((d) => d <= 0.5).length / deltas.length).toFixed(1)}%   ±1: ${(100 * deltas.filter((d) => d <= 1).length / deltas.length).toFixed(1)}%`);
  console.log(`per-bucket recenter shift (our calc): ${Object.entries(shift).sort().map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" | ")}`);
  console.log(`\nper-bucket match rate (|Δ|≤0.5) + mean|Δ|:`);
  for (const [k, b] of Object.entries(perBucket).sort()) console.log(`  ${k.padEnd(18)} ${b.ok}/${b.n} = ${(100 * b.ok / b.n).toFixed(0)}%   mean|Δ|=${(b.sd / b.n).toFixed(1)}`);
  if (worst.length) { console.log(`\nnon-exact rows (worst 10):`); worst.sort((a, b) => b.d - a.d).slice(0, 10).forEach((w) => console.log(`  ${w.key.padEnd(18)} raw=${w.raw} rec=${w.rec} stored=${w.stored} Δ${w.d.toFixed(1)}`)); }
}
const __direct = !!process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (__direct && args.includes("--vsstaging")) vsstaging().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--score")) scoreAll().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--stuffcheck")) stuffcheck().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--pitcher")) pitcher().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--mismatches")) mismatches().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--derive")) derive().catch((e) => { console.error(e); process.exit(1); });
else if (__direct && args.includes("--validate")) validate().catch((e) => { console.error(e); process.exit(1); });
else if (__direct) console.log("usage: --validate | --derive | --mismatches | --pitcher | --stuffcheck | --score  [--sample N]");
