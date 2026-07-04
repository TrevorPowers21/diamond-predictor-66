#!/usr/bin/env node
/**
 * FINAL POST-DEPLOY CHECK — diff the pre-deploy roster ground truth against the
 * post-deploy state and confirm ONLY the expected things changed:
 *   EXPECTED  : per-build watchlist targets moved to the shared team board;
 *               new default builds seeded.
 *   UNEXPECTED (fails): any on-roster player added/removed/changed, any money /
 *               depth / dev-agg change, any target LOST from the team board, or
 *               any pre-existing build deleted.
 *
 * Usage:
 *   npm run export-rosters:prod -- scripts/.rosters_before.json   # BEFORE Step 2
 *   ... run the deploy ...
 *   npm run export-rosters:prod -- scripts/.rosters_after.json    # AFTER Step 5
 *   npm run compare-rosters -- scripts/.rosters_before.json scripts/.rosters_after.json
 */
import { readFileSync } from "fs";

const beforePath = process.argv[2], afterPath = process.argv[3];
if (!beforePath || !afterPath) { console.error("Usage: compare-rosters -- <before.json> <after.json>"); process.exit(1); }
const before = JSON.parse(readFileSync(beforePath, "utf8"));
const after = JSON.parse(readFileSync(afterPath, "utf8"));

const teamByName = (snap: any) => new Map<string, any>(snap.teams.map((t: any) => [t.name, t]));
const buildById = (t: any) => new Map<string, any>((t?.builds ?? []).map((b: any) => [b.id, b]));
const side = (slot: any) => (/^(SP|RP|CL|P|LHP|RHP)$/i.test(String(slot || "")) ? "P" : "H");
const rowKey = (p: any) => `${p.name}|${side(p.position)}`;
// the coach-set fingerprint that must NOT change for an on-roster player
const fp = (p: any) => JSON.stringify({ pos: p.position, depth: p.depthRole, dev: p.devAgg, devO: p.devAggByCoach, pay: p.actualPay });

const aTeams = teamByName(after);
const unexpected: string[] = [];
const expected: string[] = [];

for (const bt of before.teams) {
  const at = aTeams.get(bt.name);
  if (!at) { unexpected.push(`TEAM DISAPPEARED: "${bt.name}"`); continue; }

  // 1. shared target board — must not LOSE anyone (may gain migrated targets)
  const beforeBoard = new Set(bt.teamTargetBoard.map((x: any) => x.name));
  const afterBoard = new Set(at.teamTargetBoard.map((x: any) => x.name));
  const lost = [...beforeBoard].filter((n) => !afterBoard.has(n));
  const gained = [...afterBoard].filter((n) => !beforeBoard.has(n));
  if (lost.length) unexpected.push(`[${bt.name}] target board LOST ${lost.length}: ${lost.slice(0, 8).join(", ")}`);
  if (gained.length) expected.push(`[${bt.name}] shared board gained ${gained.length} (migrated per-build targets)`);

  // 2. per build
  const aB = buildById(at);
  for (const bb of bt.builds) {
    const ab = aB.get(bb.id);
    if (!ab) { unexpected.push(`[${bt.name}] BUILD DELETED: "${bb.name}"`); continue; }
    // budget must match
    if (String(bb.totalBudget) !== String(ab.totalBudget)) unexpected.push(`[${bt.name}] "${bb.name}" budget ${bb.totalBudget}→${ab.totalBudget}`);

    // ROSTER (on-roster) must be identical
    const bRoster = new Map(bb.players.filter((p: any) => p.onRoster).map((p: any) => [rowKey(p), fp(p)]));
    const aRoster = new Map(ab.players.filter((p: any) => p.onRoster).map((p: any) => [rowKey(p), fp(p)]));
    for (const [k, f] of bRoster) {
      if (!aRoster.has(k)) unexpected.push(`[${bt.name}] "${bb.name}" ROSTER LOST: ${k}`);
      else if (aRoster.get(k) !== f) unexpected.push(`[${bt.name}] "${bb.name}" ROSTER CHANGED: ${k}\n      was ${f}\n      now ${aRoster.get(k)}`);
    }
    for (const k of aRoster.keys()) if (!bRoster.has(k)) unexpected.push(`[${bt.name}] "${bb.name}" ROSTER ADDED: ${k}`);

    // TARGETS (off-roster) — expected to drop toward 0 (moved to the shared board)
    const bT = bb.players.filter((p: any) => !p.onRoster).length;
    const aT = ab.players.filter((p: any) => !p.onRoster).length;
    if (bT > 0 && aT < bT) expected.push(`[${bt.name}] "${bb.name}" per-build targets ${bT}→${aT} (moved to shared board)`);
    else if (aT > bT) unexpected.push(`[${bt.name}] "${bb.name}" per-build targets GREW ${bT}→${aT}`);
  }
}

// new builds in after (seeded defaults) = expected
for (const at of after.teams) {
  const bt = before.teams.find((t: any) => t.name === at.name);
  const beforeIds = new Set((bt?.builds ?? []).map((b: any) => b.id));
  for (const ab of at.builds) if (!beforeIds.has(ab.id)) expected.push(`[${at.name}] NEW build "${ab.name}" (${ab.counts.onRoster} on roster) — seeded default`);
}

console.log(`\n=== FINAL POST-DEPLOY RECONCILIATION (${before.env ?? "?"} → ${after.env ?? "?"}) ===\n`);
console.log(`EXPECTED changes (${expected.length}):`);
expected.forEach((e) => console.log(`  ✅ ${e}`));
console.log(`\nUNEXPECTED changes (${unexpected.length}):`);
if (unexpected.length === 0) {
  console.log(`  🎉 NONE — every on-roster player, all money/depth/dev-agg, and every build are identical.`);
  console.log(`     The only changes are targets consolidating to the shared board + seeded defaults. Ship-clean.`);
} else {
  unexpected.forEach((u) => console.log(`  ❌ ${u}`));
  console.log(`\n  ⚠️  ${unexpected.length} unexpected change(s) — investigate before signing off.`);
  process.exit(1);
}
