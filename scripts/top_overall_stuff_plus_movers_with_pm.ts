/**
 * Top OVERALL pitcher Stuff+ movers prod → staging, side-by-side with
 * Pitching Master.stuff_plus (the projection-feeding source) from both
 * DBs. Gives a single view of all four Stuff+ numbers per top mover so
 * Trevor can sanity-check the display fix without dropping into a query.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SEASON = 2026;
const MIN_PITCHES = 200;
const TOP_N = 40;

function clientFromEnvFile(envFile: string) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return { sb: createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }), project: env.VITE_SUPABASE_URL.replace("https://", "").split(".")[0] };
}

async function pullPitchLog(sb: ReturnType<typeof createClient>) {
  const out: Array<{ pid: string; n: number; sum: number }> = [];
  let from = 0;
  const PAGE = 1000;
  const byPitcher = new Map<string, { sum: number; n: number }>();
  while (true) {
    const { data } = await (sb as any).from("pitch_log_pitcher_by_pitch_type")
      .select("pitcher_id, data_pitches, stuff_plus_sum")
      .eq("season", SEASON).eq("dimension_key", "all").gt("data_pitches", 0)
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.stuff_plus_sum == null || !r.data_pitches) continue;
      const e = byPitcher.get(r.pitcher_id) ?? { sum: 0, n: 0 };
      e.sum += r.stuff_plus_sum; e.n += r.data_pitches;
      byPitcher.set(r.pitcher_id, e);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  for (const [pid, v] of byPitcher) out.push({ pid, n: v.n, sum: v.sum });
  return out;
}

async function main() {
  const { sb: stagingSb } = clientFromEnvFile(".env.local");
  const { sb: prodSb } = clientFromEnvFile(".env.production.local");
  console.log(`Pulling pitch_log aggregates from both DBs...`);
  const [stagingPL, prodPL] = await Promise.all([pullPitchLog(stagingSb), pullPitchLog(prodSb)]);
  console.log(`  staging: ${stagingPL.length} pitchers, prod: ${prodPL.length} pitchers`);

  const prodMap = new Map(prodPL.map((r) => [r.pid, r]));
  type Mover = { pid: string; n: number; prod_pl: number; staging_pl: number; delta_pl: number };
  const movers: Mover[] = [];
  for (const s of stagingPL) {
    if (s.n < MIN_PITCHES) continue;
    const p = prodMap.get(s.pid);
    if (!p) continue;
    movers.push({ pid: s.pid, n: s.n, prod_pl: p.sum / p.n, staging_pl: s.sum / s.n, delta_pl: (s.sum / s.n) - (p.sum / p.n) });
  }
  movers.sort((a, b) => Math.abs(b.delta_pl) - Math.abs(a.delta_pl));
  const top = movers.slice(0, TOP_N);

  // For top movers: look up Pitching Master.stuff_plus on prod + staging + name
  const ids = top.map((m) => m.pid);
  console.log(`\nLooking up Pitching Master stuff_plus for top ${TOP_N} movers on both DBs...`);
  const [stagingPM, prodPM, names] = await Promise.all([
    (stagingSb as any).from("Pitching Master").select("source_player_id, stuff_plus").eq("Season", SEASON).in("source_player_id", ids),
    (prodSb as any).from("Pitching Master").select("source_player_id, stuff_plus").eq("Season", SEASON).in("source_player_id", ids),
    (stagingSb as any).from("players").select("source_player_id, first_name, last_name, team").in("source_player_id", ids),
  ]);
  const stagingPMMap = new Map((stagingPM.data ?? []).map((r: any) => [r.source_player_id, r.stuff_plus]));
  const prodPMMap = new Map((prodPM.data ?? []).map((r: any) => [r.source_player_id, r.stuff_plus]));
  const nameMap = new Map((names.data ?? []).map((r: any) => [r.source_player_id, `${r.first_name} ${r.last_name} (${r.team})`]));

  console.log(`\nTop ${TOP_N} OVERALL pitcher Stuff+ movers (pitch_log) — with Pitching Master Stuff+ for context\n`);
  console.log(`PITCHER (TEAM)                            N        PROD_DISP  STG_DISP  Δ_DISP    PROD_PM   STG_PM   Δ_PROJ`);
  console.log("─".repeat(110));
  for (const m of top) {
    const name = (nameMap.get(m.pid) ?? `id=${m.pid}`).padEnd(40);
    const prodPM = prodPMMap.get(m.pid);
    const stagingPM = stagingPMMap.get(m.pid);
    const deltaPM = (prodPM != null && stagingPM != null) ? (stagingPM - prodPM) : null;
    const fmt = (v: any) => v == null ? "—".padStart(6) : v.toFixed(1).padStart(6);
    const sign = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);
    console.log(`${name}  ${m.n.toString().padStart(5)}   ${fmt(m.prod_pl)}    ${fmt(m.staging_pl)}   ${sign(m.delta_pl).padStart(7)}    ${fmt(prodPM)}   ${fmt(stagingPM)}   ${deltaPM != null ? sign(deltaPM).padStart(7) : "—".padStart(7)}`);
  }
  console.log(`\nLegend:`);
  console.log(`  PROD_DISP / STG_DISP = pitch_log aggregate (Stats page display)`);
  console.log(`  PROD_PM  / STG_PM    = Pitching Master.stuff_plus (projection input)`);
  console.log(`  Δ_DISP                = display drop after staging fix ships to prod`);
  console.log(`  Δ_PROJ                = projection-input change (should be ~0; PM is independent of pitch_log bug)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
