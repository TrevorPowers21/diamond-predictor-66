#!/usr/bin/env node
/**
 * PHASE B — cross-check pitch_log derivations vs Hitter/Pitching Master
 * stored values. For each metric that exists in BOTH sources, compute
 * per-player delta, then summarize:
 *   - median |delta|
 *   - p95 |delta|
 *   - max |delta|
 *   - count of "large" deltas (> 3 pts)
 *
 * Drift > 2 pts at median signals a methodology mismatch worth fixing
 * before relying on either source. Drift < 2 pts at median is noise.
 *
 * Usage:
 *   npm run audit-phase-b
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SEASON = 2026;

async function fetchAll<T>(table: string, cols: string, dim?: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    let q = (supabase as any).from(table).select(cols).range(from, from + 999);
    if (dim) q = q.eq("season", SEASON).eq("dimension_key", dim);
    else q = q.eq("Season", SEASON);
    const { data } = await q;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function summarize(deltas: number[]) {
  if (deltas.length === 0) return { median: null, p95: null, max: null, large: 0 };
  const sorted = [...deltas].map(Math.abs).sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
    large: sorted.filter((d) => d > 3).length,
  };
}

function flag(med: number | null) {
  if (med == null) return "—";
  if (med < 1) return "✓";
  if (med < 2) return "✓~";
  if (med < 3) return "⚠";
  return "✗ DRIFT";
}

async function auditHitters() {
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  HITTER side: pitch_log vs Hitter Master (qualified PA >= 50)");
  console.log("══════════════════════════════════════════════════════════════════════");

  const pl = await fetchAll<any>(
    "pitch_log_hitter_totals",
    "batter_id, pa, ab, sac, hits_single, hits_double, hits_triple, hits_hr, bb, k, total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, batted_balls_in_play, batted_balls_with_ev, batted_barrels, batted_hard_hit, ev_sum",
    "all",
  );
  const plQ = pl.filter((r: any) => r.pa >= 50);

  const hm = await fetchAll<any>(
    "Hitter Master",
    "source_player_id, playerFullName, pa, AVG, OBP, SLG, contact, chase, barrel, avg_exit_velo, k_pct, bb",
  );
  const hmByPid = new Map<string, any>();
  for (const r of hm as any[]) hmByPid.set(String(r.source_player_id), r);

  const metrics: Record<string, (r: any, h: any) => number | null> = {
    "AVG (pl) vs HM AVG": (r, h) => {
      const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
      const pl = hits / r.ab;
      const h2 = h.AVG != null ? Number(h.AVG) : null;
      return h2 == null ? null : (pl - h2) * 1000; // diff in points (.300 vs .250 = 50pts)
    },
    "SLG (pl) vs HM SLG": (r, h) => {
      const tb = r.hits_single + 2*r.hits_double + 3*r.hits_triple + 4*r.hits_hr;
      const pl = tb / r.ab;
      const h2 = h.SLG != null ? Number(h.SLG) : null;
      return h2 == null ? null : (pl - h2) * 1000;
    },
    "Contact% (pl) vs HM": (r, h) => {
      const pl = r.total_swings > 0 ? ((r.total_swings - r.total_whiffs) / r.total_swings) * 100 : null;
      const h2 = h.contact != null ? Number(h.contact) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "Chase% (pl) vs HM": (r, h) => {
      const pl = r.total_out_of_zone > 0 ? (r.total_chases / r.total_out_of_zone) * 100 : null;
      const h2 = h.chase != null ? Number(h.chase) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "Barrel% (pl) vs HM": (r, h) => {
      const pl = r.batted_balls_with_ev >= 5 ? (r.batted_barrels / r.batted_balls_with_ev) * 100 : null;
      const h2 = h.barrel != null ? Number(h.barrel) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "Avg EV (pl) vs HM": (r, h) => {
      const pl = r.batted_balls_with_ev >= 5 ? r.ev_sum / r.batted_balls_with_ev : null;
      const h2 = h.avg_exit_velo != null ? Number(h.avg_exit_velo) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "K% (pl) vs HM": (r, h) => {
      const pl = r.pa > 0 ? (r.k / r.pa) * 100 : null;
      const h2 = h.k_pct != null ? Number(h.k_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "BB% (pl) vs HM": (r, h) => {
      const pl = r.pa > 0 ? (r.bb / r.pa) * 100 : null;
      const h2 = h.bb != null ? Number(h.bb) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
  };

  console.log(`Pop with both sources: ${plQ.filter((r: any) => hmByPid.has(String(r.batter_id))).length}\n`);
  console.log(`${"Metric".padEnd(35)} ${"med".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)} ${"large".padStart(7)}  status`);
  console.log("─".repeat(85));
  for (const [name, fn] of Object.entries(metrics)) {
    const deltas: number[] = [];
    for (const r of plQ as any[]) {
      const h = hmByPid.get(String(r.batter_id));
      if (!h) continue;
      const d = fn(r, h);
      if (d != null && Number.isFinite(d)) deltas.push(d);
    }
    const s = summarize(deltas);
    const isPts = name.includes("AVG") || name.includes("SLG");
    const unit = isPts ? "pts" : "%";
    const fmt = (v: number | null) => v == null ? "  —  " : `${v.toFixed(1)}${unit}`;
    console.log(`${name.padEnd(35)} ${fmt(s.median).padStart(7)} ${fmt(s.p95).padStart(7)} ${fmt(s.max).padStart(7)} ${s.large.toString().padStart(7)}  ${flag(s.median)}`);
  }
}

async function auditPitchers() {
  console.log("\n\n══════════════════════════════════════════════════════════════════════");
  console.log("  PITCHER side: pitch_log vs Pitching Master (qualified BF >= 50)");
  console.log("══════════════════════════════════════════════════════════════════════");

  const pl = await fetchAll<any>(
    "pitch_log_pitcher_totals",
    "pitcher_id, total_pa, total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_chases, total_out_of_zone, total_k, total_bb, stuff_plus_sum, stuff_plus_data_pitches, batted_balls_allowed_in_play, batted_balls_allowed_with_ev, batted_hard_hit_allowed, batted_ground_balls_allowed",
    "all",
  );
  const plQ = pl.filter((r: any) => r.total_pa >= 50);

  const pm = await fetchAll<any>(
    "Pitching Master",
    "source_player_id, playerFullName, stuff_plus, miss_pct, in_zone_whiff_pct, chase_pct, bb_pct, hard_hit_pct, ground_pct",
  );
  const pmByPid = new Map<string, any>();
  for (const r of pm as any[]) pmByPid.set(String(r.source_player_id), r);

  const metrics: Record<string, (r: any, h: any) => number | null> = {
    "Stuff+ (pl) vs PM": (r, h) => {
      const pl = r.stuff_plus_data_pitches > 0 ? r.stuff_plus_sum / r.stuff_plus_data_pitches : null;
      const h2 = h.stuff_plus != null ? Number(h.stuff_plus) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "Whiff% (pl) vs PM": (r, h) => {
      const pl = r.total_swings > 0 ? (r.total_whiffs / r.total_swings) * 100 : null;
      const h2 = h.miss_pct != null ? Number(h.miss_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "IZ-Whiff% (pl) vs PM": (r, h) => {
      const pl = r.total_in_zone_swings > 0 ? (r.total_in_zone_whiffs / r.total_in_zone_swings) * 100 : null;
      const h2 = h.in_zone_whiff_pct != null ? Number(h.in_zone_whiff_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "Chase% (pl) vs PM": (r, h) => {
      const pl = r.total_out_of_zone > 0 ? (r.total_chases / r.total_out_of_zone) * 100 : null;
      const h2 = h.chase_pct != null ? Number(h.chase_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "BB% (pl) vs PM": (r, h) => {
      const pl = r.total_pa > 0 ? (r.total_bb / r.total_pa) * 100 : null;
      const h2 = h.bb_pct != null ? Number(h.bb_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "HardHit% (pl) vs PM": (r, h) => {
      const pl = r.batted_balls_allowed_with_ev >= 5 ? (r.batted_hard_hit_allowed / r.batted_balls_allowed_with_ev) * 100 : null;
      const h2 = h.hard_hit_pct != null ? Number(h.hard_hit_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
    "GB% (pl) vs PM": (r, h) => {
      const pl = r.batted_balls_allowed_with_ev >= 5 ? (r.batted_ground_balls_allowed / r.batted_balls_allowed_with_ev) * 100 : null;
      const h2 = h.ground_pct != null ? Number(h.ground_pct) : null;
      return pl != null && h2 != null ? pl - h2 : null;
    },
  };

  console.log(`Pop with both sources: ${plQ.filter((r: any) => pmByPid.has(String(r.pitcher_id))).length}\n`);
  console.log(`${"Metric".padEnd(35)} ${"med".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)} ${"large".padStart(7)}  status`);
  console.log("─".repeat(85));
  for (const [name, fn] of Object.entries(metrics)) {
    const deltas: number[] = [];
    for (const r of plQ as any[]) {
      const h = pmByPid.get(String(r.pitcher_id));
      if (!h) continue;
      const d = fn(r, h);
      if (d != null && Number.isFinite(d)) deltas.push(d);
    }
    const s = summarize(deltas);
    const isStuff = name.includes("Stuff+");
    const unit = isStuff ? "" : "%";
    const fmt = (v: number | null) => v == null ? "  —  " : `${v.toFixed(1)}${unit}`;
    console.log(`${name.padEnd(35)} ${fmt(s.median).padStart(7)} ${fmt(s.p95).padStart(7)} ${fmt(s.max).padStart(7)} ${s.large.toString().padStart(7)}  ${flag(s.median)}`);
  }
}

async function main() {
  await auditHitters();
  await auditPitchers();
  console.log("\n\n══════════════════════════════════════════════════════════════════════");
  console.log("  Phase B complete. ✓ = aligned (med < 1pt). ✓~ = drift < 2pt (ok).");
  console.log("  ⚠ = drift 2-3pt (note). ✗ = drift > 3pt (investigate).");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
