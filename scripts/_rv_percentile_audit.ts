/**
 * Print the NCAA-wide RV distribution per pitch type.
 *
 * Pulls all 2026 pitch_log_pitcher_by_pitch_type rows (dimension = all)
 * from staging, filters to ≥100 pitches of that pitch type, applies the
 * corrected pitcher-perspective RV math (with proper terminal-event
 * weights), and prints the percentile breakdown so we can sanity-check:
 *
 *   - p5  / p25 / p50 / p75 / p95 / p99
 *   - Mean and SD
 *   - Sample count (qualified pitchers)
 *
 * Run after the per-pitch-type aggregation completes:
 *   tsx scripts/_rv_percentile_audit.ts
 */
import { createClient } from "@supabase/supabase-js";
import { derivePitchTypeBreakdowns } from "../src/savant/lib/pitchLogRates";

const MIN_PITCHES = 100;
const SEASON = 2026;

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function fetchAll(): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (sb as any)
      .from("pitch_log_pitcher_by_pitch_type")
      .select("*")
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .gte("pitches", MIN_PITCHES)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function main() {
  console.log(`Fetching pitch_log_pitcher_by_pitch_type season ${SEASON}, ≥${MIN_PITCHES} pitches per type…`);
  const rows = await fetchAll();
  console.log(`  pulled ${rows.length.toLocaleString()} qualified (pitcher × pitch_type) rows`);

  const breakdowns = derivePitchTypeBreakdowns(rows);

  // Group by pitch type
  const byType = new Map<string, { rv100s: number[]; rvTotals: number[] }>();
  for (const b of breakdowns) {
    if (b.rv100 == null || b.rvTotal == null) continue;
    if (!byType.has(b.pitchType)) byType.set(b.pitchType, { rv100s: [], rvTotals: [] });
    byType.get(b.pitchType)!.rv100s.push(b.rv100);
    byType.get(b.pitchType)!.rvTotals.push(b.rvTotal);
  }

  // Print header
  console.log(`\n${"".padEnd(80, "─")}`);
  console.log(`PITCHER-PERSPECTIVE RV (positive = pitcher saved runs)`);
  console.log(`Per pitch type, ≥${MIN_PITCHES} pitches of that type`);
  console.log(`${"".padEnd(80, "─")}`);
  console.log(
    `${"PITCH TYPE".padEnd(20)} ${"N".padStart(5)} ` +
      `${"p5".padStart(7)} ${"p25".padStart(7)} ${"p50".padStart(7)} ${"p75".padStart(7)} ${"p95".padStart(7)} ${"p99".padStart(7)}`,
  );

  // For each pitch type, print RV/100 + RV TOTAL percentiles
  const sortedTypes = [...byType.entries()].sort(
    (a, b) => b[1].rv100s.length - a[1].rv100s.length,
  );

  console.log(`\n── RV/100 (per 100 pitches) ─────────────────────────────────────`);
  for (const [type, data] of sortedTypes) {
    const arr = data.rv100s;
    console.log(
      `${type.padEnd(20)} ${arr.length.toString().padStart(5)} ` +
        `${pct(arr, 5).toFixed(2).padStart(7)} ${pct(arr, 25).toFixed(2).padStart(7)} ${pct(arr, 50).toFixed(2).padStart(7)} ${pct(arr, 75).toFixed(2).padStart(7)} ${pct(arr, 95).toFixed(2).padStart(7)} ${pct(arr, 99).toFixed(2).padStart(7)}`,
    );
  }

  console.log(`\n── RV TOTAL (cumulative across all pitches of that type) ────────`);
  for (const [type, data] of sortedTypes) {
    const arr = data.rvTotals;
    console.log(
      `${type.padEnd(20)} ${arr.length.toString().padStart(5)} ` +
        `${pct(arr, 5).toFixed(1).padStart(7)} ${pct(arr, 25).toFixed(1).padStart(7)} ${pct(arr, 50).toFixed(1).padStart(7)} ${pct(arr, 75).toFixed(1).padStart(7)} ${pct(arr, 95).toFixed(1).padStart(7)} ${pct(arr, 99).toFixed(1).padStart(7)}`,
    );
  }
  console.log();
}
main().catch((e) => { console.error(e); process.exit(1); });
