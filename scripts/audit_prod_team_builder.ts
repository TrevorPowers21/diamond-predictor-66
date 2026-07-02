#!/usr/bin/env node
/**
 * READ-ONLY prod audit of Team Builder state, to confirm the target-board
 * consolidation invariants before deploy + capture what every user/team has done.
 *
 * Checks:
 *  - Universal target board: per-build WATCHLIST target sets (drift the migration
 *    collapses) + resulting distinct (team,player) universal size + existing
 *    target_board coverage.
 *  - On-roster targets (included_in_roster=true) are BUILD-SPECIFIC (a player
 *    on-roster in build A but not build B of the same team).
 *  - Dev-aggressiveness + depth overrides live per-build (production_notes /
 *    depth_assignments).
 *  - Imported local players (null player_id + custom_name).
 *
 * Usage: npm run audit-tb:prod    (no writes)
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
if (!url.includes("trbvxuoliwrfowibatkm")) { console.error("Refusing: not pointed at prod."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

async function pageAll<T>(table: string, cols: string): Promise<T[]> {
  const PAGE = 1000; let out: T[] = []; let from = 0;
  while (true) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat((data as any) || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
const meta = (pn: any) => { try { return JSON.parse(pn || "{}"); } catch { return {}; } };
const isTargetRow = (r: any) => r.source === "portal" || meta(r.production_notes).rosterStatus === "target";
const isWatchlist = (r: any) => isTargetRow(r) && r.included_in_roster === false;
const isOnRoster = (r: any) => isTargetRow(r) && r.included_in_roster !== false;

(async () => {
  console.log("Loading prod…");
  const teams = await pageAll<any>("customer_teams", "id,name,active");
  // select * — prod may predate the default-build migration (no is_default /
  // academic_year columns). Missing is_default -> undefined -> treated as coach.
  const builds = await pageAll<any>("team_builds", "*");
  const bps = await pageAll<any>("team_build_players", "build_id,player_id,source,included_in_roster,custom_name,production_notes");
  const tb = await pageAll<any>("target_board", "customer_team_id,player_id");
  const access = await pageAll<any>("user_team_access", "user_id,customer_team_id,role");
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const bpByBuild = new Map<string, any[]>();
  for (const r of bps) { (bpByBuild.get(r.build_id) ?? bpByBuild.set(r.build_id, []).get(r.build_id))!.push(r); }
  const buildTeam = new Map(builds.map((b) => [b.id, b.customer_team_id]));

  // ── Global ─────────────────────────────────────────────────────────────
  const coachBuilds = builds.filter((b) => !b.is_default);
  const teamsWithCoach = new Set(coachBuilds.map((b) => b.customer_team_id));
  console.log(`\n=== GLOBAL ===`);
  console.log(`teams: ${teams.length} (${teams.filter(t=>t.active).length} active) | with coach builds: ${teamsWithCoach.size}`);
  console.log(`builds: ${builds.length} (coach ${coachBuilds.length}, default ${builds.length - coachBuilds.length})`);
  console.log(`team_build_players: ${bps.length} | user_team_access: ${access.length} | target_board: ${tb.length}`);

  // ── Target consolidation impact ────────────────────────────────────────
  const watch = bps.filter(isWatchlist).filter((r) => r.player_id && buildTeam.get(r.build_id));
  const distinctWatch = new Set(watch.map((r) => `${buildTeam.get(r.build_id)}|${r.player_id}`));
  const tbKeys = new Set(tb.map((r) => `${r.customer_team_id}|${r.player_id}`));
  const notYetOnBoard = [...distinctWatch].filter((k) => !tbKeys.has(k)).length;
  console.log(`\n=== TARGET CONSOLIDATION (migrate-targets:prod would do) ===`);
  console.log(`per-build watchlist rows to migrate: ${watch.length}`);
  console.log(`-> distinct (team,player) universal targets: ${distinctWatch.size}`);
  console.log(`   already on target_board: ${distinctWatch.size - notYetOnBoard} | net-new inserts: ${notYetOnBoard}`);

  // ── Drift: same-team builds with DIFFERENT watchlist sets (what consolidation fixes) ──
  let driftTeams = 0; const driftEx: string[] = [];
  for (const t of teams) {
    const tBuilds = coachBuilds.filter((b) => b.customer_team_id === t.id);
    if (tBuilds.length < 2) continue;
    const sets = tBuilds.map((b) => new Set((bpByBuild.get(b.id) ?? []).filter(isWatchlist).map((r) => r.player_id)));
    const union = new Set(sets.flatMap((s) => [...s]));
    const allSame = sets.every((s) => s.size === union.size);
    if (!allSame && union.size > 0) { driftTeams++; if (driftEx.length < 5) driftEx.push(`${t.name} (${tBuilds.length} builds, watchlist sizes ${sets.map(s=>s.size).join("/")})`); }
  }
  console.log(`\n=== WATCHLIST DRIFT (pre-consolidation, expected) ===`);
  console.log(`teams whose builds show DIFFERENT watchlists: ${driftTeams}`);
  driftEx.forEach((e) => console.log(`   ${e}`));

  // ── On-roster targets are build-specific ───────────────────────────────
  const onRosterTotal = bps.filter(isOnRoster).length;
  let buildSpecificEx: string[] = [];
  for (const t of teams) {
    const tBuilds = coachBuilds.filter((b) => b.customer_team_id === t.id);
    if (tBuilds.length < 2) continue;
    const perBuild = tBuilds.map((b) => ({ name: b.name, on: new Set((bpByBuild.get(b.id) ?? []).filter(isOnRoster).map((r) => r.player_id)) }));
    const anyOn = perBuild.some((p) => p.on.size > 0);
    const differ = new Set(perBuild.flatMap((p) => [...p.on])).size !== Math.max(...perBuild.map((p) => p.on.size), 0) || perBuild.some((p,i)=> i>0 && p.on.size !== perBuild[0].on.size);
    if (anyOn && differ && buildSpecificEx.length < 5) buildSpecificEx.push(`${t.name}: ${perBuild.map((p) => `${p.on.size}`).join("/")} on-roster across builds`);
  }
  console.log(`\n=== ON-ROSTER TARGETS (should be build-specific) ===`);
  console.log(`total on-roster target rows: ${onRosterTotal}`);
  buildSpecificEx.forEach((e) => console.log(`   ${e}`));

  // ── Dev-agg + depth overrides (per build) ──────────────────────────────
  const devAggOverrides = bps.filter((r) => meta(r.production_notes).devAggressivenessOverridden === true).length;
  const depthRoleRows = bps.filter((r) => meta(r.production_notes).depthRole).length;
  const buildsWithDepthAssign = builds.filter((b) => b.depth_assignments && Object.keys(b.depth_assignments).length > 0).length;
  const importedLocal = bps.filter((r) => !r.player_id && r.custom_name && String(r.custom_name).trim()).length;
  console.log(`\n=== PER-BUILD OVERRIDES (must survive deploy) ===`);
  console.log(`dev-agg overrides (devAggressivenessOverridden=true): ${devAggOverrides} rows`);
  console.log(`rows with explicit depthRole: ${depthRoleRows}`);
  console.log(`builds with depth_assignments: ${buildsWithDepthAssign}`);
  console.log(`imported local players (null id + custom_name): ${importedLocal}`);

  // ── Per-team rollup (what every team/user has) ─────────────────────────
  console.log(`\n=== PER-TEAM (teams with coach builds) ===`);
  for (const t of teams) {
    const tBuilds = coachBuilds.filter((b) => b.customer_team_id === t.id);
    if (!tBuilds.length) continue;
    const users = new Set(access.filter((a) => a.customer_team_id === t.id).map((a) => a.user_id));
    const rows = tBuilds.flatMap((b) => bpByBuild.get(b.id) ?? []);
    console.log(`  ${t.name}: ${tBuilds.length} builds, ${users.size} user(s) | on-roster=${rows.filter(isOnRoster).length} watchlist=${rows.filter(isWatchlist).length} imported=${rows.filter(r=>!r.player_id&&r.custom_name).length}`);
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
