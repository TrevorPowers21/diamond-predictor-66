/**
 * OVERALL pitcher Stuff+ comparison: PROD vs STAGING.
 *
 * Rolls each pitcher's Stuff+ up across ALL pitch types (weighted by
 * data_pitches), then compares prod vs staging to surface the biggest
 * pitcher-level movers a coach will notice on the Stuff+ Overview line.
 *
 * Also computes each pitcher's average physics per pitch type, z-scores
 * vs the D1 population pop constants, and flags pitchers whose AVERAGE
 * metrics are extreme outliers on any dimension (|z| ≥ 3) — these are
 * the pitchers whose unusual deliveries drive the engine and are most
 * sensitive to model assumptions.
 *
 * Usage:
 *   tsx scripts/compare_overall_stuff_plus.ts [--season 2026] [--min-pitches 200] [--top 50]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SEASON = Number(process.argv.find((a) => a.startsWith("--season"))?.split("=")[1] ?? 2026);
const MIN_PITCHES = Number(process.argv.find((a) => a.startsWith("--min-pitches"))?.split("=")[1] ?? 200);
const TOP_N = Number(process.argv.find((a) => a.startsWith("--top"))?.split("=")[1] ?? 50);

const RECLASS_TO_ENGINE: Record<string, string> = {
  "4-Seam Fastball": "4S FB", "Sinker": "Sinker", "Cutter": "Cutter",
  "Gyro Slider": "Gyro Slider", "Slider": "Slider", "Sweeper": "Sweeper",
  "Curveball": "Curveball", "Change-up": "Change-up", "Splitter": "Splitter",
};

function clientFromEnvFile(envFile: string) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Missing env in ${envFile}`);
  return { sb: createClient(url, key, { auth: { persistSession: false } }), project: url.replace("https://", "").split(".")[0] };
}

type PerType = { pitcher_id: string; pitch_type_reclassified: string; data_pitches: number; stuff_plus_sum: number };

async function pullByType(sb: ReturnType<typeof createClient>) {
  const out: PerType[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await (sb as any)
      .from("pitch_log_pitcher_by_pitch_type")
      .select("pitcher_id, pitch_type_reclassified, data_pitches, stuff_plus_sum")
      .eq("season", SEASON).eq("dimension_key", "all").gt("data_pitches", 0)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function rollUp(rows: PerType[]) {
  const byPitcher = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (r.stuff_plus_sum == null || r.data_pitches == null || r.data_pitches === 0) continue;
    const e = byPitcher.get(r.pitcher_id) ?? { sum: 0, n: 0 };
    e.sum += r.stuff_plus_sum;
    e.n += r.data_pitches;
    byPitcher.set(r.pitcher_id, e);
  }
  return byPitcher;
}

async function main() {
  console.log(`OVERALL pitcher Stuff+ comparison — season ${SEASON}, min ${MIN_PITCHES} total data pitches\n`);

  const { sb: stagingSb, project: stagingProj } = clientFromEnvFile(".env.local");
  const { sb: prodSb, project: prodProj } = clientFromEnvFile(".env.production.local");
  const stagingRows = await pullByType(stagingSb);
  const prodRows = await pullByType(prodSb);
  console.log(`  staging (${stagingProj}): ${stagingRows.length} per-pitch-type rows`);
  console.log(`  prod (${prodProj}):    ${prodRows.length} per-pitch-type rows`);

  const stagingByP = rollUp(stagingRows);
  const prodByP = rollUp(prodRows);

  // Compare
  type Mover = { pitcher_id: string; prod: number; staging: number; delta: number; n: number };
  const movers: Mover[] = [];
  for (const [pid, s] of stagingByP.entries()) {
    if (s.n < MIN_PITCHES) continue;
    const p = prodByP.get(pid);
    if (!p) continue;
    movers.push({ pitcher_id: pid, prod: p.sum / p.n, staging: s.sum / s.n, delta: (s.sum / s.n) - (p.sum / p.n), n: s.n });
  }
  console.log(`  ${movers.length} pitchers joined (with ≥${MIN_PITCHES} data pitches)\n`);

  // Names
  const ids = movers.map((m) => m.pitcher_id);
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await (stagingSb as any).from("players").select("source_player_id, first_name, last_name, team").in("source_player_id", ids.slice(i, i + 1000));
    for (const p of data ?? []) nameById.set(p.source_player_id, `${p.first_name} ${p.last_name} (${p.team ?? "—"})`);
  }

  // Summary
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const drops5 = movers.filter((m) => m.delta < -5).length;
  const drops10 = movers.filter((m) => m.delta < -10).length;
  const drops15 = movers.filter((m) => m.delta < -15).length;
  const lifts = movers.filter((m) => m.delta > 5).length;
  const avgAbs = movers.reduce((s, m) => s + Math.abs(m.delta), 0) / movers.length;
  console.log(`Overall pitcher-level Stuff+ summary across ${movers.length} pitchers:`);
  console.log(`  Avg |Δ|:           ${avgAbs.toFixed(1)} Stuff+`);
  console.log(`  Drops > 5:         ${drops5}`);
  console.log(`  Drops > 10:        ${drops10}`);
  console.log(`  Drops > 15:        ${drops15}  ← these pitchers' overall Stuff+ moves significantly`);
  console.log(`  Lifts > 5:         ${lifts}`);

  console.log(`\nTop ${TOP_N} biggest OVERALL Stuff+ movers (pitcher-level, weighted across all pitch types):`);
  console.log(`  PITCHER (TEAM)                              N         PROD    STAGING    Δ`);
  console.log(`  ${"─".repeat(96)}`);
  for (const m of movers.slice(0, TOP_N)) {
    const name = (nameById.get(m.pitcher_id) ?? `id=${m.pitcher_id}`).padEnd(41);
    const sign = m.delta > 0 ? "+" : "";
    console.log(`  ${name}   ${m.n.toString().padStart(5)}    ${m.prod.toFixed(1).padStart(6)}   ${m.staging.toFixed(1).padStart(7)}   ${sign}${m.delta.toFixed(1)}`);
  }

  // ── Metric-outlier detection ─────────────────────────────────────────
  console.log(`\n\n═══ METRIC OUTLIER SCAN (staging) ═══`);
  console.log(`Flagging pitchers whose AVERAGE metric (per pitch type) is |z| ≥ 3.0 vs D1 pop\n`);

  const { data: popRows } = await (stagingSb as any)
    .from("pitcher_stuff_plus_ncaa").select("*").eq("season", SEASON).eq("division", "D1");
  const popMap = new Map<string, any>();
  for (const p of popRows as any[]) popMap.set(`${p.pitch_type}::${p.hand}`, p);

  // For each pitcher × pitch_type × hand, compute average metrics from raw pitch_log
  type AvgRow = { pid: string; ptype: string; hand: string; n: number; velocity: number; ivb: number; hb: number; spin: number; rel_height: number; rel_side: number; extension: number };
  const metricBuckets = new Map<string, AvgRow>();
  let lastId = "";
  const CHUNK = 50_000;
  while (true) {
    const { data } = await (stagingSb as any)
      .from("pitch_log")
      .select("uniq_pitch_id, pitcher_id, pitch_type_reclassified, pitcher_hand, release_velocity, ivb, hb, spin, rel_height, rel_side, extension")
      .eq("season", SEASON).eq("is_data", true).gt("uniq_pitch_id", lastId).order("uniq_pitch_id").limit(CHUNK);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!r.pitch_type_reclassified || !RECLASS_TO_ENGINE[r.pitch_type_reclassified]) continue;
      if (r.pitcher_hand !== "L" && r.pitcher_hand !== "R") continue;
      if (r.release_velocity == null) continue;
      const k = `${r.pitcher_id}|${r.pitch_type_reclassified}|${r.pitcher_hand}`;
      let b = metricBuckets.get(k);
      if (!b) { b = { pid: r.pitcher_id, ptype: r.pitch_type_reclassified, hand: r.pitcher_hand, n: 0, velocity: 0, ivb: 0, hb: 0, spin: 0, rel_height: 0, rel_side: 0, extension: 0 }; metricBuckets.set(k, b); }
      b.n++; b.velocity += r.release_velocity; b.ivb += r.ivb ?? 0; b.hb += r.hb ?? 0; b.spin += r.spin ?? 0; b.rel_height += r.rel_height ?? 0; b.rel_side += r.rel_side ?? 0; b.extension += r.extension ?? 0;
    }
    lastId = data[data.length - 1].uniq_pitch_id;
  }
  console.log(`Built ${metricBuckets.size.toLocaleString()} (pitcher × pitch_type × hand) buckets for outlier scan`);

  type Outlier = { pid: string; ptype: string; hand: string; n: number; metric: string; pitcher_avg: number; pop_avg: number; z: number };
  const outliers: Outlier[] = [];
  for (const b of metricBuckets.values()) {
    if (b.n < 30) continue;
    const enginePT = RECLASS_TO_ENGINE[b.ptype];
    const pop = popMap.get(`${enginePT}::${b.hand}`);
    if (!pop) continue;
    const metrics = [
      { name: "velocity",  pitcher: b.velocity   / b.n, pop_avg: pop.velocity,   pop_sd: pop.velocity_sd },
      { name: "ivb",       pitcher: b.ivb        / b.n, pop_avg: pop.ivb,        pop_sd: pop.ivb_sd },
      { name: "hb",        pitcher: b.hb         / b.n, pop_avg: pop.hb,         pop_sd: pop.hb_sd },
      { name: "spin",      pitcher: b.spin       / b.n, pop_avg: pop.spin,       pop_sd: pop.spin_sd },
      { name: "rel_height",pitcher: b.rel_height / b.n, pop_avg: pop.rel_height, pop_sd: pop.rel_height_sd },
      { name: "rel_side",  pitcher: b.rel_side   / b.n, pop_avg: pop.rel_side,   pop_sd: pop.rel_side_sd },
      { name: "extension", pitcher: b.extension  / b.n, pop_avg: pop.extension,  pop_sd: pop.extension_sd },
    ];
    for (const m of metrics) {
      if (!m.pop_sd || m.pop_sd === 0) continue;
      const z = (m.pitcher - m.pop_avg) / m.pop_sd;
      if (Math.abs(z) >= 3.0) outliers.push({ pid: b.pid, ptype: b.ptype, hand: b.hand, n: b.n, metric: m.name, pitcher_avg: m.pitcher, pop_avg: m.pop_avg, z });
    }
  }
  outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  console.log(`${outliers.length} (pitcher × pitch_type × metric) outliers with |z| ≥ 3.0\n`);

  console.log(`Top 30 metric outliers — these are the pitchers most sensitive to engine assumptions:`);
  console.log(`  PITCHER (TEAM)                          PITCH                HAND  N      METRIC       AVG       POP_AVG     |z|`);
  console.log(`  ${"─".repeat(120)}`);
  for (const o of outliers.slice(0, 30)) {
    const name = (nameById.get(o.pid) ?? `id=${o.pid}`).padEnd(38);
    console.log(`  ${name}   ${o.ptype.padEnd(18)}   ${o.hand}    ${o.n.toString().padStart(4)}    ${o.metric.padEnd(10)}   ${o.pitcher_avg.toFixed(1).padStart(7)}   ${o.pop_avg.toFixed(1).padStart(7)}    ${o.z.toFixed(2)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
