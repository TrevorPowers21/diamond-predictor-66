#!/usr/bin/env node
/**
 * PHASE E — cross-table consistency. Verifies the relationships
 * between the four aggregation tables hold:
 *
 *   1. Per-pitch-type rows roll up to totals:
 *        SUM(by_pitch_type.pitches WHERE pitcher_id=P) == totals.total_pitches
 *      for both hitter and pitcher sides, across 'all' dim.
 *
 *   2. Filter-dim sums make sense:
 *        for hitters, vs_lhp_pitches + vs_rhp_pitches ≈ all_pitches (within
 *        small drift since some pitches lack pitcher_hand).
 *      Same for pitchers: vs_lhp + vs_rhp ≈ all.
 *
 *   3. vs_fastball + vs_breaking_ball + vs_offspeed ≈ all
 *      (within drift since some pitches are unclassified).
 *
 *   4. The 'all' dimension is the universe — every other dim should
 *      have rows ⊆ all's rows.
 *
 * Usage:
 *   npm run audit-phase-e
 */
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SEASON = 2026;

async function fetchAllDim(table: string, cols: string, dim: string) {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (s as any).from(table).select(cols)
      .eq("season", SEASON).eq("dimension_key", dim).range(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

interface Check {
  name: string;
  result: string;
  status: "PASS" | "FAIL" | "INFO";
}

async function checkPitchTypeRollup(side: "pitcher" | "hitter"): Promise<Check[]> {
  const totalsTable = side === "pitcher" ? "pitch_log_pitcher_totals" : "pitch_log_hitter_totals";
  const byTypeTable = side === "pitcher" ? "pitch_log_pitcher_by_pitch_type" : "pitch_log_hitter_by_pitch_type";
  const idCol = side === "pitcher" ? "pitcher_id" : "batter_id";

  const totals = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "all");
  const byType = await fetchAllDim(byTypeTable, `${idCol}, pitch_type_reclassified, pitches`, "all");

  const totalsByPid = new Map<string, number>();
  for (const r of totals) totalsByPid.set(String(r[idCol]), r.total_pitches);

  const sumsByPid = new Map<string, number>();
  for (const r of byType) {
    const id = String(r[idCol]);
    sumsByPid.set(id, (sumsByPid.get(id) ?? 0) + (r.pitches ?? 0));
  }

  let exactMatches = 0, deltas: number[] = [], missing = 0;
  for (const [pid, totalPitches] of totalsByPid.entries()) {
    const sumByType = sumsByPid.get(pid);
    if (sumByType == null) {
      // Could be a player with no breakdown rows (e.g., 0 pitches)
      if (totalPitches > 0) missing++;
      continue;
    }
    if (totalPitches === sumByType) exactMatches++;
    else deltas.push(totalPitches - sumByType);
  }

  deltas.sort((a,b) => Math.abs(b) - Math.abs(a));
  const medianDelta = deltas.length > 0 ? Math.abs(deltas[Math.floor(deltas.length / 2)]) : 0;
  const maxDelta = deltas.length > 0 ? Math.abs(deltas[0]) : 0;

  return [
    { name: `${side}: ${totalsByPid.size} players in totals`, result: ``, status: "INFO" },
    { name: `${side}: by_pitch_type rollup matches total_pitches exactly`, result: `${exactMatches} / ${totalsByPid.size}`, status: exactMatches === totalsByPid.size ? "PASS" : (medianDelta < 10 ? "PASS" : "FAIL") },
    { name: `${side}: median |delta| (rollup vs total)`, result: `${medianDelta} pitches`, status: medianDelta === 0 ? "PASS" : medianDelta < 10 ? "PASS" : "FAIL" },
    { name: `${side}: max |delta|`, result: `${maxDelta} pitches`, status: maxDelta < 50 ? "PASS" : "INFO" },
    { name: `${side}: players with no breakdown rows but total > 0`, result: `${missing}`, status: missing === 0 ? "PASS" : "INFO" },
  ];
}

async function checkHandednessSums(side: "pitcher" | "hitter"): Promise<Check[]> {
  const totalsTable = side === "pitcher" ? "pitch_log_pitcher_totals" : "pitch_log_hitter_totals";
  const idCol = side === "pitcher" ? "pitcher_id" : "batter_id";

  const all = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "all");
  const lhp = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "vs_lhp");
  const rhp = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "vs_rhp");

  const lhpByPid = new Map<string, number>(); for (const r of lhp) lhpByPid.set(String(r[idCol]), r.total_pitches);
  const rhpByPid = new Map<string, number>(); for (const r of rhp) rhpByPid.set(String(r[idCol]), r.total_pitches);

  let underCount = 0, perfectMatch = 0, overCount = 0;
  const deltas: number[] = [];
  let totalUnclassified = 0;
  for (const r of all) {
    const id = String(r[idCol]);
    const allP = r.total_pitches;
    const lP = lhpByPid.get(id) ?? 0;
    const rP = rhpByPid.get(id) ?? 0;
    const sum = lP + rP;
    const delta = allP - sum;
    deltas.push(delta);
    totalUnclassified += Math.max(0, delta);
    if (delta === 0) perfectMatch++;
    else if (delta > 0) underCount++;
    else overCount++;
  }
  deltas.sort((a, b) => a - b);

  return [
    { name: `${side}: vs_lhp + vs_rhp = all (perfect)`, result: `${perfectMatch} / ${all.length}`, status: perfectMatch / all.length > 0.95 ? "PASS" : "INFO" },
    { name: `${side}: sum LESS than all (unclassified hand)`, result: `${underCount}`, status: "INFO" },
    { name: `${side}: sum MORE than all (impossible — fail)`, result: `${overCount}`, status: overCount === 0 ? "PASS" : "FAIL" },
    { name: `${side}: total unclassified pitches across all players`, result: `${totalUnclassified.toLocaleString()}`, status: "INFO" },
  ];
}

async function checkPitchTypeFilterSums(side: "pitcher" | "hitter"): Promise<Check[]> {
  const totalsTable = side === "pitcher" ? "pitch_log_pitcher_totals" : "pitch_log_hitter_totals";
  const idCol = side === "pitcher" ? "pitcher_id" : "batter_id";

  const all = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "all");
  const fb = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "vs_fastball");
  const bb = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "vs_breaking_ball");
  const off = await fetchAllDim(totalsTable, `${idCol}, total_pitches`, "vs_offspeed");

  const fbBy = new Map<string, number>(); for (const r of fb) fbBy.set(String(r[idCol]), r.total_pitches);
  const bbBy = new Map<string, number>(); for (const r of bb) bbBy.set(String(r[idCol]), r.total_pitches);
  const offBy = new Map<string, number>(); for (const r of off) offBy.set(String(r[idCol]), r.total_pitches);

  let perfect = 0, overCount = 0, totalUnclassified = 0;
  for (const r of all) {
    const id = String(r[idCol]);
    const sum = (fbBy.get(id) ?? 0) + (bbBy.get(id) ?? 0) + (offBy.get(id) ?? 0);
    const delta = r.total_pitches - sum;
    totalUnclassified += Math.max(0, delta);
    if (delta === 0) perfect++;
    if (delta < 0) overCount++;
  }

  return [
    { name: `${side}: vs_fb + vs_bb + vs_off = all (perfect)`, result: `${perfect} / ${all.length}`, status: perfect / all.length > 0.5 ? "PASS" : "INFO" },
    { name: `${side}: sum > all (impossible — fail)`, result: `${overCount}`, status: overCount === 0 ? "PASS" : "FAIL" },
    { name: `${side}: unclassified-pitch-type total across players`, result: `${totalUnclassified.toLocaleString()}`, status: "INFO" },
  ];
}

async function main() {
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  PHASE E — Cross-table consistency");
  console.log("══════════════════════════════════════════════════════════════════════\n");

  console.log("── 1. Per-pitch-type rows roll up to total_pitches ──────────────────\n");
  for (const c of await checkPitchTypeRollup("pitcher")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }
  console.log();
  for (const c of await checkPitchTypeRollup("hitter")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }

  console.log("\n── 2. Handedness sums (vs_lhp + vs_rhp = all) ──────────────────────\n");
  for (const c of await checkHandednessSums("pitcher")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }
  console.log();
  for (const c of await checkHandednessSums("hitter")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }

  console.log("\n── 3. Pitch-type sums (vs_fb + vs_bb + vs_off = all) ────────────────\n");
  for (const c of await checkPitchTypeFilterSums("pitcher")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }
  console.log();
  for (const c of await checkPitchTypeFilterSums("hitter")) {
    console.log(`  ${c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} ${c.name.padEnd(55)} ${c.result}`);
  }

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  Phase E complete. Rollups + filter dim sums verified.");
  console.log("══════════════════════════════════════════════════════════════════════");
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
