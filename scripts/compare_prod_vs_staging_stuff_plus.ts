/**
 * Compare aggregated Stuff+ on PROD vs STAGING per (pitcher × pitch_type)
 * to identify the biggest movers that coaches will notice when the staging
 * fix ships to prod.
 *
 * Pulls pitch_log_pitcher_by_pitch_type (dimension_key='all') from both,
 * joins on (pitcher_id, pitch_type_reclassified), computes the displayed
 * Stuff+ delta, and prints the top changers.
 *
 * Outputs sorted by absolute delta. Includes the pitcher name + team for
 * easy lookup.
 *
 * Usage:
 *   tsx scripts/compare_prod_vs_staging_stuff_plus.ts [--season 2026] [--min-pitches 50] [--top 100]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SEASON = Number(process.argv.find((a) => a.startsWith("--season"))?.split("=")[1] ?? 2026);
const MIN_PITCHES = Number(process.argv.find((a) => a.startsWith("--min-pitches"))?.split("=")[1] ?? 50);
const TOP_N = Number(process.argv.find((a) => a.startsWith("--top"))?.split("=")[1] ?? 100);

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
  const project = url.replace("https://", "").split(".")[0];
  return { sb: createClient(url, key, { auth: { persistSession: false } }), project };
}

type AggRow = { pitcher_id: string; pitch_type_reclassified: string; data_pitches: number; stuff_plus_sum: number };

async function pullAll(sb: ReturnType<typeof createClient>) {
  const out: AggRow[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await (sb as any)
      .from("pitch_log_pitcher_by_pitch_type")
      .select("pitcher_id, pitch_type_reclassified, data_pitches, stuff_plus_sum")
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .gte("data_pitches", MIN_PITCHES)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  console.log(`Pulling aggregated Stuff+ from STAGING + PROD, season ${SEASON}, min ${MIN_PITCHES} data pitches\n`);

  const { sb: stagingSb, project: stagingProject } = clientFromEnvFile(".env.local");
  const staging = await pullAll(stagingSb);
  console.log(`  staging (${stagingProject}): ${staging.length} buckets`);

  const { sb: prodSb, project: prodProject } = clientFromEnvFile(".env.production.local");
  const prod = await pullAll(prodSb);
  console.log(`  prod (${prodProject}): ${prod.length} buckets`);

  // Index prod by key
  const key = (pid: string, pt: string) => `${pid}|${pt}`;
  const prodByKey = new Map<string, AggRow>();
  for (const r of prod) prodByKey.set(key(r.pitcher_id, r.pitch_type_reclassified), r);

  // Compare
  type Mover = { pitcher_id: string; pitch_type: string; prod_avg: number; staging_avg: number; delta: number; prod_n: number; staging_n: number };
  const movers: Mover[] = [];
  for (const s of staging) {
    const p = prodByKey.get(key(s.pitcher_id, s.pitch_type_reclassified));
    if (!p) continue;
    const stagingAvg = s.data_pitches > 0 ? s.stuff_plus_sum / s.data_pitches : null;
    const prodAvg = p.data_pitches > 0 ? p.stuff_plus_sum / p.data_pitches : null;
    if (stagingAvg == null || prodAvg == null) continue;
    movers.push({
      pitcher_id: s.pitcher_id,
      pitch_type: s.pitch_type_reclassified,
      prod_avg: prodAvg,
      staging_avg: stagingAvg,
      delta: stagingAvg - prodAvg,
      prod_n: p.data_pitches,
      staging_n: s.data_pitches,
    });
  }
  console.log(`  ${movers.length} buckets joined\n`);

  // Pull pitcher names from staging
  const ids = [...new Set(movers.map((m) => m.pitcher_id))];
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await (stagingSb as any).from("players").select("source_player_id, first_name, last_name, team").in("source_player_id", ids.slice(i, i + 1000));
    for (const p of data ?? []) nameById.set(p.source_player_id, `${p.first_name} ${p.last_name} (${p.team ?? "—"})`);
  }

  // Sort by abs delta
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Summary stats
  const drops = movers.filter((m) => m.delta < -5).length;
  const lifts = movers.filter((m) => m.delta > 5).length;
  const major = movers.filter((m) => Math.abs(m.delta) >= 15).length;
  const avgAbsDelta = movers.reduce((sum, m) => sum + Math.abs(m.delta), 0) / movers.length;
  console.log(`Summary across ${movers.length} buckets:`);
  console.log(`  Avg |Δ|:                ${avgAbsDelta.toFixed(1)} Stuff+`);
  console.log(`  Drops > 5:              ${drops}`);
  console.log(`  Lifts > 5:              ${lifts}`);
  console.log(`  Major changes (|Δ|≥15): ${major}`);

  console.log(`\nTop ${TOP_N} biggest movers (staging fix - prod current):`);
  console.log(`  PITCHER (TEAM)                              PITCH                  STAGE_N  PROD    STAGING   Δ`);
  console.log(`  ${"─".repeat(110)}`);
  for (const m of movers.slice(0, TOP_N)) {
    const name = (nameById.get(m.pitcher_id) ?? `id=${m.pitcher_id}`).padEnd(41);
    const sign = m.delta > 0 ? "+" : "";
    console.log(`  ${name}   ${m.pitch_type.padEnd(20)}   ${m.staging_n.toString().padStart(5)}   ${m.prod_avg.toFixed(1).padStart(5)}   ${m.staging_avg.toFixed(1).padStart(6)}   ${sign}${m.delta.toFixed(1)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
