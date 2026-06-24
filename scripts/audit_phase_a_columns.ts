#!/usr/bin/env node
/**
 * PHASE A — Column-level integrity audit across all pitch_log aggregation tables.
 *
 * For each table:
 *  - Row count (should match expected ~5,000-6,000 across 7-9 dimensions)
 *  - For each numeric column: NULL count, min, max, mean, sum
 *  - Cross-column sanity checks:
 *      - in_zone + out_of_zone <= total_pitches (rest is untracked)
 *      - in_zone_swings <= in_zone
 *      - in_zone_whiffs <= in_zone_swings
 *      - hits_single + hits_double + hits_triple + hits_hr <= ab
 *      - batted_balls_with_ev <= batted_balls_in_play
 *      - batted_barrels <= batted_hard_hit <= batted_balls_with_ev
 *      - x_hits_sum <= ab (can't expect more hits than ABs)
 *      - stuff_plus_data_pitches <= total_pitches (etc.)
 *  - Flag rows that fail any check
 *
 * Usage:
 *   npm run audit-phase-a
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const SEASON = 2026;

interface SanityCheck {
  name: string;
  fail: (r: any) => boolean;
  details?: (r: any) => string;
}

async function fetchAll<T>(table: string, cols: string, dim?: string): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    let q = (supabase as any).from(table).select(cols).eq("season", SEASON).range(from, from + 999);
    if (dim) q = q.eq("dimension_key", dim);
    const { data } = await q;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function summarize(rows: any[], col: string) {
  let nulls = 0, sum = 0, n = 0, min = Infinity, max = -Infinity;
  for (const r of rows) {
    const v = r[col];
    if (v == null) { nulls++; continue; }
    n++; sum += Number(v); min = Math.min(min, v); max = Math.max(max, v);
  }
  return {
    nulls, n,
    mean: n > 0 ? sum / n : null,
    min: n > 0 ? min : null,
    max: n > 0 ? max : null,
  };
}

function fmt(v: any) {
  if (v == null) return "—".padStart(10);
  if (typeof v === "number") return (v < 1 && v > 0 ? v.toFixed(3) : v.toFixed(1)).padStart(10);
  return String(v).padStart(10);
}

async function auditTable(label: string, table: string, cols: string[], dim: string, checks: SanityCheck[]) {
  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`  ${label}  (dim=${dim})`);
  console.log(`══════════════════════════════════════════════════════════════════════`);
  const rows = await fetchAll<any>(table, "*", dim);
  console.log(`Rows: ${rows.length}\n`);

  console.log(`${"Column".padEnd(35)} ${"NULL".padStart(7)} ${"n".padStart(7)} ${"mean".padStart(10)} ${"min".padStart(10)} ${"max".padStart(10)}`);
  console.log("─".repeat(85));
  for (const c of cols) {
    const s = summarize(rows, c);
    console.log(`${c.padEnd(35)} ${s.nulls.toString().padStart(7)} ${s.n.toString().padStart(7)} ${fmt(s.mean)} ${fmt(s.min)} ${fmt(s.max)}`);
  }

  console.log(`\nSANITY CHECKS:`);
  console.log("─".repeat(85));
  for (const check of checks) {
    const failed = rows.filter((r) => check.fail(r));
    const ok = failed.length === 0;
    console.log(`  ${ok ? "✓" : "✗"} ${check.name.padEnd(55)} ${ok ? "PASS" : `FAIL (${failed.length} rows)`}`);
    if (!ok && check.details && failed.length > 0) {
      const sample = failed.slice(0, 3);
      for (const r of sample) console.log(`      ${check.details(r)}`);
    }
  }
}

async function main() {
  // ─── hitter_totals ──────────────────────────────────────────────────
  await auditTable(
    "HITTER TOTALS",
    "pitch_log_hitter_totals",
    [
      "pa", "ab",
      "hits_single", "hits_double", "hits_triple", "hits_hr",
      "k", "bb", "hbp", "sac",
      "total_pitches", "total_swings", "total_takes",
      "total_data_pitches", "total_velo_pitches",
      "total_in_zone", "total_in_zone_swings", "total_in_zone_whiffs", "total_out_of_zone",
      "total_chases", "total_whiffs", "total_fouls",
      "batted_balls_in_play",
      "batted_ground_balls", "batted_line_drives", "batted_fly_balls", "batted_pop_ups",
      "batted_barrels", "batted_hard_hit", "batted_la_10_to_30",
      "ev_sum", "batted_balls_with_ev", "max_ev",
      "x_hits_sum", "x_bases_sum", "x_woba_sum",
    ],
    "all",
    [
      { name: "hits sum ≤ ab", fail: (r) => (r.hits_single+r.hits_double+r.hits_triple+r.hits_hr) > r.ab },
      { name: "ab ≤ pa", fail: (r) => r.ab > r.pa },
      { name: "in_zone + out_of_zone ≤ total_pitches", fail: (r) => (r.total_in_zone + r.total_out_of_zone) > r.total_pitches },
      { name: "total_in_zone_swings ≤ total_in_zone", fail: (r) => r.total_in_zone_swings > r.total_in_zone },
      { name: "total_in_zone_whiffs ≤ total_in_zone_swings", fail: (r) => r.total_in_zone_whiffs > r.total_in_zone_swings },
      { name: "total_whiffs ≤ total_swings", fail: (r) => r.total_whiffs > r.total_swings },
      { name: "total_chases ≤ total_out_of_zone", fail: (r) => r.total_chases > r.total_out_of_zone, details: (r) => `batter ${r.batter_id}: chases=${r.total_chases} ooz=${r.total_out_of_zone}` },
      { name: "batted_balls_with_ev ≤ batted_balls_in_play", fail: (r) => r.batted_balls_with_ev > r.batted_balls_in_play },
      { name: "batted_barrels ≤ batted_hard_hit", fail: (r) => r.batted_barrels > r.batted_hard_hit },
      { name: "batted_hard_hit ≤ batted_balls_with_ev", fail: (r) => r.batted_hard_hit > r.batted_balls_with_ev },
      { name: "x_hits_sum ≤ ab + sac (xBA ≤ 1.000)", fail: (r) => r.x_hits_sum > (r.ab + (r.sac ?? 0)), details: (r) => `batter ${r.batter_id}: x_hits_sum=${r.x_hits_sum?.toFixed(2)} xAB=${r.ab + (r.sac ?? 0)}` },
      { name: "x_bases_sum ≤ 4*(ab+sac) (xSLG ≤ 4.000)", fail: (r) => r.x_bases_sum > 4 * (r.ab + (r.sac ?? 0)) },
      { name: "no negative counts", fail: (r) => ["pa","ab","total_pitches","total_chases","batted_barrels"].some(c => r[c] < 0) },
      { name: "x_hits_sum ≈ AVG when 100% tracked (within 0.3)", fail: (r) => {
        if (r.batted_balls_in_play === 0 || r.batted_balls_with_ev / r.batted_balls_in_play < 0.95) return false;
        if (r.ab < 50) return false;
        const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
        const avg = hits / r.ab;
        const xba = (r.x_hits_sum ?? 0) / r.ab;
        return Math.abs(xba - avg) > 0.3;
      }, details: (r) => {
        const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
        return `batter ${r.batter_id}: AVG=${(hits/r.ab).toFixed(3)} xBA=${(r.x_hits_sum/r.ab).toFixed(3)} tracking=${(r.batted_balls_with_ev/r.batted_balls_in_play*100).toFixed(0)}%`;
      } },
    ],
  );

  // ─── pitcher_totals ─────────────────────────────────────────────────
  await auditTable(
    "PITCHER TOTALS",
    "pitch_log_pitcher_totals",
    [
      "total_pitches", "total_swings", "total_data_pitches", "total_velo_pitches",
      "total_in_zone", "total_in_zone_swings", "total_in_zone_whiffs", "total_out_of_zone",
      "total_chases", "total_whiffs", "total_strikes", "total_fouls", "total_called_strikes",
      "total_pa", "total_k", "total_bb",
      "batted_balls_allowed_in_play", "batted_balls_allowed_with_ev",
      "batted_barrels_allowed", "batted_hard_hit_allowed", "ev_sum_allowed",
      "batted_ground_balls_allowed", "batted_line_drives_allowed", "batted_fly_balls_allowed", "batted_pop_ups_allowed",
      "stuff_plus_sum", "stuff_plus_data_pitches",
      "fb_velo_sum", "fb_velo_pitches",
      "total_ab", "hits_single_allowed", "hits_double_allowed", "hits_triple_allowed", "hits_hr_allowed",
      "x_hits_sum_allowed", "x_bases_sum_allowed", "x_woba_sum_allowed",
    ],
    "all",
    [
      { name: "in_zone + out_of_zone ≤ total_pitches", fail: (r) => (r.total_in_zone + r.total_out_of_zone) > r.total_pitches },
      { name: "total_chases ≤ total_out_of_zone", fail: (r) => r.total_chases > r.total_out_of_zone },
      { name: "total_whiffs ≤ total_swings", fail: (r) => r.total_whiffs > r.total_swings },
      { name: "batted_balls_allowed_with_ev ≤ batted_balls_allowed_in_play", fail: (r) => r.batted_balls_allowed_with_ev > r.batted_balls_allowed_in_play },
      { name: "barrels_allowed ≤ hard_hit_allowed", fail: (r) => r.batted_barrels_allowed > r.batted_hard_hit_allowed },
      { name: "x_hits_sum_allowed ≤ total_ab", fail: (r) => r.x_hits_sum_allowed > r.total_ab },
      { name: "stuff_plus_data_pitches ≤ total_pitches", fail: (r) => r.stuff_plus_data_pitches > r.total_pitches },
      { name: "fb_velo_pitches ≤ total_velo_pitches", fail: (r) => r.fb_velo_pitches > r.total_velo_pitches },
      { name: "no negative counts", fail: (r) => ["total_pitches","total_chases","total_k","total_bb"].some(c => r[c] < 0) },
    ],
  );

  console.log("\n\n══════════════════════════════════════════════════════════════════════");
  console.log("  Phase A complete. Proceed to Phase B if all checks pass.");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
