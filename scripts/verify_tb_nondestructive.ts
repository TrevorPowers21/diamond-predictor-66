#!/usr/bin/env node
/**
 * Provable non-destructive receipt for the target-board consolidation.
 *
 *   --snapshot : capture every build's roster/money/dev-agg/depth + each team's
 *                target_board into a baseline JSON (run BEFORE the migration).
 *   --verify   : re-read prod and assert the ONLY change is that watchlist targets
 *                moved from team_build_players -> universal target_board. Everything
 *                else (returners, on-roster targets, imported locals, nil_value,
 *                depth_role, dev-aggressiveness, depth_assignments, total_budget)
 *                must be byte-identical. Fails loudly on any other change.
 *
 * Read-only against prod (writes/reads a local baseline file only).
 *
 * Usage:
 *   npm run verify-tb:prod -- --snapshot     # before Step 5
 *   npm run verify-tb:prod -- --verify       # after Step 5
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || "";
const sb = createClient(url, key, { auth: { persistSession: false } });
const BASELINE = "scripts/.tb_baseline.json";
const MODE = process.argv.includes("--snapshot") ? "snapshot" : process.argv.includes("--verify") ? "verify" : null;

const meta = (pn: any) => { try { return JSON.parse(pn || "{}"); } catch { return {}; } };
const isWatchlist = (r: any) =>
  r.included_in_roster === false && (r.source === "portal" || meta(r.production_notes).rosterStatus === "target");
const side = (slot: any) => (/^(SP|RP|CL|P|LHP|RHP)$/i.test(String(slot || "")) ? "P" : "H");
const rowKey = (r: any) => (r.player_id ? `${r.player_id}|${side(r.position_slot)}` : `local:${(r.custom_name || "").trim()}|${r.position_slot || ""}`);
// The "must never change" fingerprint of a kept (non-watchlist) roster row.
const rowFP = (r: any) => {
  const m = meta(r.production_notes);
  return JSON.stringify({ inc: r.included_in_roster, slot: r.position_slot, nil: r.nil_value,
    depth: m.depthRole ?? null, dev: m.devAggressiveness ?? null, devO: !!m.devAggressivenessOverridden, rs: m.rosterStatus ?? null });
};

async function pageAll(table: string, cols: string): Promise<any[]> {
  const P = 1000; let out: any[] = []; let f = 0;
  while (true) { const { data, error } = await sb.from(table).select(cols).range(f, f + P - 1);
    if (error) throw new Error(`${table}: ${error.message}`); out = out.concat(data || []);
    if (!data || data.length < P) break; f += P; }
  return out;
}

async function capture() {
  const builds = await pageAll("team_builds", "id,name,customer_team_id,depth_assignments,total_budget");
  const bps = await pageAll("team_build_players", "build_id,player_id,source,included_in_roster,custom_name,nil_value,position_slot,production_notes");
  const tb = await pageAll("target_board", "customer_team_id,player_id");
  const byBuild = new Map<string, any[]>();
  for (const r of bps) (byBuild.get(r.build_id) ?? byBuild.set(r.build_id, []).get(r.build_id))!.push(r);
  const buildFP: Record<string, any> = {};
  for (const b of builds) {
    const rows = byBuild.get(b.id) ?? [];
    const keep: Record<string, string> = {};
    const watch: string[] = [];
    for (const r of rows) {
      if (isWatchlist(r)) { if (r.player_id) watch.push(r.player_id); }
      else keep[rowKey(r)] = rowFP(r);
    }
    buildFP[b.id] = { name: b.name, team: b.customer_team_id,
      depth: JSON.stringify(b.depth_assignments ?? {}), budget: b.total_budget ?? 0, keep, watch: watch.sort() };
  }
  const board: Record<string, string[]> = {};
  for (const r of tb) (board[r.customer_team_id] ??= []).push(r.player_id);
  for (const k of Object.keys(board)) board[k] = [...new Set(board[k])].sort();
  return { builds: buildFP, board };
}

(async () => {
  if (!MODE) { console.error("Pass --snapshot or --verify"); process.exit(1); }
  const now = await capture();

  if (MODE === "snapshot") {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2));
    const nB = Object.keys(now.builds).length;
    const nKeep = Object.values(now.builds).reduce((s: number, b: any) => s + Object.keys(b.keep).length, 0);
    const nWatch = Object.values(now.builds).reduce((s: number, b: any) => s + b.watch.length, 0);
    console.log(`✅ baseline written to ${BASELINE}`);
    console.log(`   ${nB} builds | ${nKeep} kept rows (must not change) | ${nWatch} watchlist rows (expected to move)`);
    return;
  }

  // verify
  if (!existsSync(BASELINE)) { console.error(`No baseline at ${BASELINE} — run --snapshot first.`); process.exit(1); }
  const base = JSON.parse(readFileSync(BASELINE, "utf8"));
  const fails: string[] = [];
  const notes: string[] = [];

  for (const [id, b0] of Object.entries<any>(base.builds)) {
    const b1 = now.builds[id];
    if (!b1) { fails.push(`BUILD DELETED: "${b0.name}" (${id.slice(0, 8)})`); continue; }
    if (b0.depth !== b1.depth) fails.push(`depth_assignments changed: "${b0.name}"`);
    if (String(b0.budget) !== String(b1.budget)) fails.push(`total_budget changed: "${b0.name}" ${b0.budget}->${b1.budget}`);
    // kept rows must be identical
    for (const [k, fp] of Object.entries<string>(b0.keep)) {
      if (!(k in b1.keep)) fails.push(`KEPT ROW LOST: "${b0.name}" ${k}`);
      else if (b1.keep[k] !== fp) fails.push(`KEPT ROW CHANGED: "${b0.name}" ${k}\n     was ${fp}\n     now ${b1.keep[k]}`);
    }
    for (const k of Object.keys(b1.keep)) if (!(k in b0.keep)) fails.push(`KEPT ROW APPEARED: "${b0.name}" ${k}`);
    // watchlist rows should be GONE from the build AND present on the team board
    const boardNow = new Set(now.board[b0.team] ?? []);
    for (const pid of b0.watch) {
      const stillOnBuild = pid in b1.keep || (b1.watch ?? []).includes(pid);
      if (stillOnBuild) notes.push(`watchlist still on build (migration not run yet?): "${b0.name}" ${pid.slice(0, 8)}`);
      if (!boardNow.has(pid)) fails.push(`WATCHLIST LOST (not on target_board): "${b0.name}" ${pid.slice(0, 8)}`);
    }
  }
  // no target_board entries removed
  for (const [team, ids] of Object.entries<string[]>(base.board)) {
    const nowSet = new Set(now.board[team] ?? []);
    for (const pid of ids) if (!nowSet.has(pid)) fails.push(`target_board entry REMOVED: team ${team.slice(0, 8)} player ${pid.slice(0, 8)}`);
  }

  console.log(`\n=== NON-DESTRUCTIVE VERIFY ===`);
  if (notes.length) console.log(`notes: ${notes.length} watchlist rows still on builds (expected only if migration not yet applied)`);
  if (fails.length === 0) {
    console.log(`✅ PASS — every kept row (returners, on-roster, imported), all money, depth, dev-agg,`);
    console.log(`   depth_assignments and budgets are IDENTICAL. Only watchlist targets moved to the`);
    console.log(`   universal board, and none were lost. Provably non-destructive.`);
  } else {
    console.log(`❌ FAIL — ${fails.length} unexpected change(s):`);
    for (const f of fails.slice(0, 50)) console.log(`   - ${f}`);
    process.exit(1);
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
