#!/usr/bin/env node
/**
 * PHASE C — percentile-rank accuracy + distribution sanity across all
 * 16 filter dimensions (7 pitcher × 9 hitter).
 *
 * Checks:
 *   1. Population sizes per dimension (qualified count)
 *   2. Distribution sanity: p10/p25/p50/p75/p90 for each metric per dim
 *   3. Reference player percentile ranks per dim (Hudson, Piasecki, Marot,
 *      Roblez) — verifies their position in the distribution
 *   4. invert handling: low-is-better metrics (Chase%, K% for hitter) rank
 *      backwards correctly
 *   5. Cross-dim consistency: a hitter's "all" percentile shouldn't differ
 *      wildly from "vs RHP" (~75% overlap of pitches faced)
 *
 * Usage:
 *   npm run audit-phase-c
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SEASON = 2026;

const PITCHER_DIMS = ["all", "vs_lhp", "vs_rhp", "vs_fastball", "vs_breaking_ball", "vs_offspeed", "vs_top_hitters"];
const HITTER_DIMS = ["all", "vs_lhp", "vs_rhp", "vs_92plus", "vs_fastball", "vs_breaking_ball", "vs_offspeed", "vs_stuff_100plus", "vs_stuff_105plus"];

const PITCHER_QUALIFIED_PITCHES = 100;
const HITTER_QUALIFIED_PA = 30;

const REF_PITCHERS = [{ id: "1180787200", name: "Roblez" }];
const REF_HITTERS = [
  { id: "1750930555", name: "Piasecki" },
  { id: "1342167668", name: "Brown" },
  { id: "1342169501", name: "Marot" },
];

const safeDiv = (n: number | null, d: number | null) =>
  n != null && d != null && d > 0 ? n / d : null;

function pct(arr: number[], q: number) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function rankIn(arr: number[], v: number, invert = false) {
  let below = 0;
  for (const x of arr) if (x < v) below++;
  let pctRank = (below / arr.length) * 100;
  return invert ? 100 - pctRank : pctRank;
}

async function fetchDim(table: string, cols: string, dim: string) {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (supabase as any)
      .from(table).select(cols)
      .eq("season", SEASON).eq("dimension_key", dim).range(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

interface MetricSpec {
  label: string;
  fn: (r: any) => number | null;
  invert?: boolean;
  fmt: (v: number) => string;
}

async function auditPitcherDims() {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  PITCHER side · percentile accuracy across 7 filter dimensions");
  console.log("══════════════════════════════════════════════════════════════════════\n");

  const cols = "pitcher_id, total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_pa, total_k, total_bb, stuff_plus_sum, stuff_plus_data_pitches, fb_velo_sum, fb_velo_pitches, batted_balls_allowed_with_ev, batted_barrels_allowed, batted_hard_hit_allowed";

  const metrics: MetricSpec[] = [
    { label: "Stuff+", fn: (r) => safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches), fmt: (v) => v.toFixed(1) },
    { label: "FB Velo", fn: (r) => safeDiv(r.fb_velo_sum, r.fb_velo_pitches), fmt: (v) => v.toFixed(1) },
    { label: "Whiff%", fn: (r) => safeDiv(r.total_whiffs, r.total_swings), fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "Chase%", fn: (r) => safeDiv(r.total_chases, r.total_out_of_zone), fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "K%", fn: (r) => safeDiv(r.total_k, r.total_pa), fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "BB%", fn: (r) => safeDiv(r.total_bb, r.total_pa), invert: true, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "Barrel%-a", fn: (r) => r.batted_balls_allowed_with_ev >= 5 ? r.batted_barrels_allowed / r.batted_balls_allowed_with_ev : null, invert: true, fmt: (v) => `${(v*100).toFixed(1)}%` },
  ];

  for (const dim of PITCHER_DIMS) {
    const all = await fetchDim("pitch_log_pitcher_totals", cols, dim);
    const qual = all.filter((r: any) => r.total_pitches >= PITCHER_QUALIFIED_PITCHES);
    const roblez = qual.find((r: any) => r.pitcher_id === "1180787200");
    console.log(`── ${dim.padEnd(22)} qual=${qual.length.toString().padStart(4)} ${roblez ? "" : "(Roblez not in qual)"}`);
    for (const m of metrics) {
      const vals = qual.map(m.fn).filter((v): v is number => v != null);
      if (vals.length === 0) continue;
      const refVal = roblez ? m.fn(roblez) : null;
      const refRank = refVal != null ? rankIn(vals, refVal, m.invert) : null;
      console.log(`    ${m.label.padEnd(10)} p10 ${m.fmt(pct(vals,.1)).padStart(7)}  p50 ${m.fmt(pct(vals,.5)).padStart(7)}  p90 ${m.fmt(pct(vals,.9)).padStart(7)}${refRank != null ? `  Roblez ${m.fmt(refVal!)} (p${refRank.toFixed(0)})` : ""}`);
    }
    console.log("");
  }
}

async function auditHitterDims() {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  HITTER side · percentile accuracy across 9 filter dimensions");
  console.log("══════════════════════════════════════════════════════════════════════\n");

  const cols = "batter_id, pa, ab, sac, hits_single, hits_double, hits_triple, hits_hr, bb, k, total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, batted_balls_with_ev, batted_barrels, batted_hard_hit, ev_sum";

  const metrics: MetricSpec[] = [
    { label: "Contact%", fn: (r) => r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "Chase%", fn: (r) => safeDiv(r.total_chases, r.total_out_of_zone), invert: true, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "K%", fn: (r) => safeDiv(r.k, r.pa), invert: true, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "BB%", fn: (r) => safeDiv(r.bb, r.pa), fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "Barrel%", fn: (r) => r.batted_balls_with_ev >= 5 ? r.batted_barrels / r.batted_balls_with_ev : null, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "HardHit%", fn: (r) => r.batted_balls_with_ev >= 5 ? r.batted_hard_hit / r.batted_balls_with_ev : null, fmt: (v) => `${(v*100).toFixed(1)}%` },
    { label: "Avg EV", fn: (r) => r.batted_balls_with_ev >= 5 ? r.ev_sum / r.batted_balls_with_ev : null, fmt: (v) => v.toFixed(1) },
  ];

  for (const dim of HITTER_DIMS) {
    const all = await fetchDim("pitch_log_hitter_totals", cols, dim);
    const qual = all.filter((r: any) => r.pa >= HITTER_QUALIFIED_PA);
    const refs = REF_HITTERS.map(p => ({ p, row: qual.find((r: any) => r.batter_id === p.id) }));
    console.log(`── ${dim.padEnd(22)} qual=${qual.length.toString().padStart(4)}`);
    for (const m of metrics) {
      const vals = qual.map(m.fn).filter((v): v is number => v != null);
      if (vals.length === 0) continue;
      let line = `    ${m.label.padEnd(10)} p10 ${m.fmt(pct(vals,.1)).padStart(7)}  p50 ${m.fmt(pct(vals,.5)).padStart(7)}  p90 ${m.fmt(pct(vals,.9)).padStart(7)}`;
      for (const ref of refs) {
        if (!ref.row) continue;
        const v = m.fn(ref.row);
        if (v == null) continue;
        const r = rankIn(vals, v, m.invert);
        line += `  ${ref.p.name} p${r.toFixed(0)}`;
      }
      console.log(line);
    }
    console.log("");
  }
}

async function main() {
  await auditPitcherDims();
  await auditHitterDims();
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Phase C complete.");
  console.log("  Sanity: qual pop should drop as filters narrow.");
  console.log("  Sanity: reference players' percentiles should be consistent across");
  console.log("          related dimensions (e.g., 'all' similar to 'vs_rhp' for");
  console.log("          most hitters).");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
