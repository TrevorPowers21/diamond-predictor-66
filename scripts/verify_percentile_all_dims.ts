#!/usr/bin/env node
/**
 * Audit every percentile-bar metric across every filter dimension.
 *
 * For each dimension: shows the qualified-pop size, key distribution
 * percentiles, and the reference player's rank within that dimension's
 * qualified pop.
 *
 * Catches: filter dimensions where the qualified pool is too thin, or
 * percentile ranks that look wrong vs the 'all' dimension.
 *
 * Usage:
 *   npm run verify-percentile-all-dims
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const PITCHER_MIN_PITCHES = 100;
const HITTER_MIN_PA = 30;

const PITCHER_DIMS = [
  "all",
  "vs_lhp",
  "vs_rhp",
  "vs_fastball",
  "vs_breaking_ball",
  "vs_offspeed",
  "vs_top_hitters",
];
const HITTER_DIMS = [
  "all",
  "vs_lhp",
  "vs_rhp",
  "vs_92plus",
  "vs_fastball",
  "vs_breaking_ball",
  "vs_offspeed",
  "vs_stuff_100plus",
  "vs_stuff_105plus",
];

const ROBLEZ = "1180787200";
const PIASECKI = "1750930555";

const safeDiv = (n: number | null, d: number | null) =>
  n != null && d != null && d > 0 ? n / d : null;

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function rankIn(arr: number[], v: number): number {
  let below = 0;
  for (const x of arr) if (x <= v) below++;
  return (below / arr.length) * 100;
}

async function fetchAllInDim(table: string, cols: string, dim: string) {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(cols)
      .eq("season", SEASON)
      .eq("dimension_key", dim)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

interface KeyMetric {
  label: string;
  fn: (r: any) => number | null;
  fmt: (v: number) => string;
}

async function auditPitcherDims() {
  console.log("=== PITCHER side, by dimension ===\n");
  const cols =
    "pitcher_id, total_pitches, total_swings, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_whiffs, total_called_strikes, total_pa, total_k, total_bb, total_ab, x_hits_sum_allowed, x_bases_sum_allowed, stuff_plus_sum, stuff_plus_data_pitches, fb_velo_sum, fb_velo_pitches";

  const keyMetrics: KeyMetric[] = [
    {
      label: "Stuff+",
      fn: (r) => safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches),
      fmt: (v) => v.toFixed(1),
    },
    {
      label: "FB Velo",
      fn: (r) => safeDiv(r.fb_velo_sum, r.fb_velo_pitches),
      fmt: (v) => v.toFixed(1),
    },
    {
      label: "Whiff%",
      fn: (r) => safeDiv(r.total_whiffs, r.total_swings),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "Chase%",
      fn: (r) => safeDiv(r.total_chases, r.total_out_of_zone),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "K%",
      fn: (r) => safeDiv(r.total_k, r.total_pa),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "xBA-a",
      fn: (r) => safeDiv(r.x_hits_sum_allowed, r.total_ab),
      fmt: (v) => v.toFixed(3).replace(/^0+/, ""),
    },
  ];

  for (const dim of PITCHER_DIMS) {
    const all = await fetchAllInDim("pitch_log_pitcher_totals", cols, dim);
    const qual = all.filter((r) => r.total_pitches >= PITCHER_MIN_PITCHES);
    const roblez = qual.find((r) => r.pitcher_id === ROBLEZ);
    const tag = roblez ? "yes" : "no";
    console.log(`── ${dim.padEnd(22)} | pop ${all.length.toString().padStart(5)} | qualified ${qual.length.toString().padStart(5)} | Roblez in qual: ${tag}`);
    if (qual.length < 50) {
      console.log(`  (qualified pop < 50, skipping rank details)\n`);
      continue;
    }
    for (const m of keyMetrics) {
      const vals = qual.map(m.fn).filter((v): v is number => v != null);
      if (vals.length === 0) continue;
      const rVal = roblez ? m.fn(roblez) : null;
      const rPart =
        rVal != null
          ? ` | Roblez ${m.fmt(rVal)} (p${rankIn(vals, rVal).toFixed(0)})`
          : "";
      console.log(
        `    ${m.label.padEnd(8)}p50 ${m.fmt(percentile(vals, 50)).padStart(8)}  p90 ${m.fmt(percentile(vals, 90)).padStart(8)}${rPart}`,
      );
    }
    console.log("");
  }
}

async function auditHitterDims() {
  console.log("\n=== HITTER side, by dimension ===\n");
  const cols =
    "batter_id, pa, ab, hits_single, hits_double, hits_triple, hits_hr, bb, hbp, sac, k, total_pitches, total_swings, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_whiffs, batted_balls_in_play, batted_barrels, batted_hard_hit, ev_sum, batted_balls_with_ev, max_ev, x_hits_sum, x_bases_sum";

  const keyMetrics: KeyMetric[] = [
    {
      label: "Contact%",
      fn: (r) =>
        r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "Chase%",
      fn: (r) => safeDiv(r.total_chases, r.total_out_of_zone),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "K%",
      fn: (r) => safeDiv(r.k, r.pa),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "Hard Hit%",
      fn: (r) => safeDiv(r.batted_hard_hit, r.batted_balls_in_play),
      fmt: (v) => `${(v * 100).toFixed(1)}%`,
    },
    {
      label: "Avg EV",
      fn: (r) => safeDiv(r.ev_sum, r.batted_balls_with_ev),
      fmt: (v) => v.toFixed(1),
    },
    {
      label: "Max EV",
      fn: (r) => r.max_ev,
      fmt: (v) => v.toFixed(1),
    },
    {
      label: "xBA",
      fn: (r) => safeDiv(r.x_hits_sum, r.ab),
      fmt: (v) => v.toFixed(3).replace(/^0+/, ""),
    },
  ];

  for (const dim of HITTER_DIMS) {
    const all = await fetchAllInDim("pitch_log_hitter_totals", cols, dim);
    const qual = all.filter((r) => r.pa >= HITTER_MIN_PA);
    const piasecki = qual.find((r) => r.batter_id === PIASECKI);
    const tag = piasecki ? "yes" : "no";
    console.log(`── ${dim.padEnd(22)} | pop ${all.length.toString().padStart(5)} | qualified ${qual.length.toString().padStart(5)} | Piasecki in qual: ${tag}`);
    if (qual.length < 50) {
      console.log(`  (qualified pop < 50, skipping rank details)\n`);
      continue;
    }
    for (const m of keyMetrics) {
      const vals = qual.map(m.fn).filter((v): v is number => v != null);
      if (vals.length === 0) continue;
      const pVal = piasecki ? m.fn(piasecki) : null;
      const pPart =
        pVal != null
          ? ` | Piasecki ${m.fmt(pVal)} (p${rankIn(vals, pVal).toFixed(0)})`
          : "";
      console.log(
        `    ${m.label.padEnd(8)}p50 ${m.fmt(percentile(vals, 50)).padStart(8)}  p90 ${m.fmt(percentile(vals, 90)).padStart(8)}${pPart}`,
      );
    }
    console.log("");
  }
}

async function main() {
  await auditPitcherDims();
  await auditHitterDims();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
