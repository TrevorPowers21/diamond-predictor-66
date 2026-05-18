#!/usr/bin/env node
/**
 * Add JUCO hitters that exist in Presto Sports but are missing from
 * staging Hitter Master. Sourced from presto-import-none.csv produced
 * by import-juco-presto-hitters.ts.
 *
 * Cohort: PA ≥ 75 only (matches the sim qualifier).
 *
 * For each new player we insert:
 *   1. players row — UUID, division=NJCAA_D1, source_player_id=presto-<sha1>
 *   2. Hitter Master row — same source_player_id, triple slash + PA + AB + BB
 *      + Team / TeamID / Conference / conference_id resolved from Teams Table
 *   3. player_predictions row — model_type=returner variant=regular season=2026
 *      with from_avg / from_obp / from_slg, status=active
 *
 * Synthetic source_player_id format: `presto-<sha1(name+team)[:16]>` so
 * re-imports are idempotent. When a real source_player_id surfaces in a
 * future canonical import, run a backfill to swap presto-* → real id.
 *
 * Usage:
 *   npm run add-presto-missing -- <none.csv path>             # dry-run
 *   npm run add-presto-missing -- <path> --apply              # write
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const CONFIRM = "yes-add-presto-missing";
const PA_THRESHOLD = 75;
const SEASON = 2026;
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

function parseCSVRow(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function normalizeTeam(raw: string): string {
  let s = stripDiacritics(raw).toLowerCase().trim();
  s = s.replace(/\busc\b/g, "south carolina");
  s = s.replace(/\blsu\b/g, "louisiana state university");
  s = s.replace(/\bnmmi\b/g, "new mexico military institute");
  s = s.replace(/\bnjc\b/g, "new mexico junior");
  s = s.replace(/\bwvu\b/g, "west virginia");
  s = s.replace(/\belaine p\.? nunez\b/g, "nunez");
  s = s.replace(/\btallahassee state\b/g, "tallahassee");
  s = s.replace(/\bgrayson county\b/g, "grayson");
  s = s.replace(/\bcollege of southern idaho\b/g, "southern idaho");
  s = s.replace(/\bsouthern idaho \(jc\)\b/g, "southern idaho");
  s = s.replace(/\bcommunity college\b/g, "cc");
  s = s.replace(/\bjunior college\b/g, "jc");
  s = s.replace(/\bcollege\b/g, "");
  s = s.replace(/\buniversity\b/g, "");
  s = s.replace(/\bof\b/g, "");
  s = s.replace(/\bstate\b/g, "st");
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
function tokenOverlap(a: string, b: string): number {
  const aSet = new Set(a.split(" ").filter(Boolean));
  const bSet = new Set(b.split(" ").filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let common = 0; for (const t of aSet) if (bSet.has(t)) common++;
  return (2 * common) / (aSet.size + bSet.size);
}

function splitName(presto: string): { first: string; last: string } {
  // Presto exports "Last, First" — split it back.
  if (presto.includes(",")) {
    const [last, first] = presto.split(",").map((s) => s.trim());
    return { first, last };
  }
  // Fallback: "First Last"
  const parts = presto.trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") || "" };
}

function syntheticSourceId(name: string, team: string): string {
  const hash = createHash("sha1").update(`presto:${name.trim()}:${team.trim()}`).digest("hex").slice(0, 16);
  return `presto-${hash}`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath || !existsSync(csvPath)) {
    err("Usage: npm run add-presto-missing -- <none.csv path> [--apply]");
    process.exit(1);
  }

  console.log(COLOR.bold + `\n══ Add Presto Missing JUCO Hitters ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL"); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse ──────────────────────────────────────────────────────────
  step("Parsing CSV");
  const lines = readFileSync(csvPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  type Row = { name: string; team: string; pa: number; avg: number; obp: number; slg: number; iso: number };
  const all: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    if (cells.length < 4) continue;
    const pa = Number(cells[2]) || 0;
    const avg = Number(cells[3]) || 0;
    all.push({
      name: cells[0],
      team: cells[1],
      pa,
      avg,
      obp: 0, slg: 0, iso: 0,  // will hydrate from full Presto CSV below
    });
  }
  info(`${all.length} total NONE rows`);
  const cohort = all.filter((r) => r.pa >= PA_THRESHOLD);
  info(`${cohort.length} qualify (PA ≥ ${PA_THRESHOLD})`);

  // none.csv only carries PA + AVG — re-read full Presto CSV to get OBP/SLG too
  step("Re-reading full Presto CSV for OBP/SLG");
  const fullCsv = "/Users/danielleogonowski/RSTR IQ Data/juco-exploration/2026 JUCO Main Stats 051826.csv";
  if (!existsSync(fullCsv)) { err(`Full Presto CSV not found at ${fullCsv}`); process.exit(1); }
  const fullLines = readFileSync(fullCsv, "utf-8").split(/\r?\n/).filter((l) => l.trim());
  const prestoByKey = new Map<string, { gp: number; ab: number; h: number; rbi: number; bb: number; k: number; avg: number; obp: number; slg: number; pa: number }>();
  for (let i = 1; i < fullLines.length; i++) {
    const c = parseCSVRow(fullLines[i]);
    if (c.length < 20) continue;
    const key = `${c[1]}|${c[2]}`;
    prestoByKey.set(key, {
      gp: Number(c[3]) || 0, ab: Number(c[4]) || 0, h: Number(c[5]) || 0, rbi: Number(c[6]) || 0,
      bb: Number(c[7]) || 0, k: Number(c[8]) || 0,
      avg: Number(c[9]) || 0, obp: Number(c[10]) || 0, slg: Number(c[11]) || 0, pa: Number(c[19]) || 0,
    });
  }
  for (const r of cohort) {
    const full = prestoByKey.get(`${r.name}|${r.team}`);
    if (full) { r.obp = full.obp; r.slg = full.slg; r.iso = Math.round((full.slg - full.avg) * 1000) / 1000; }
  }

  // ── Resolve team → Teams Table row ─────────────────────────────────
  step("Loading Teams Table (2026)");
  const { data: tt } = await (sb as any)
    .from("Teams Table")
    .select("id, full_name, abbreviation, conference, conference_id, district")
    .eq("Season", SEASON)
    .eq("division", "NJCAA_D1");
  info(`${tt?.length ?? 0} JUCO Teams Table 2026 rows loaded`);
  // Index by normalized team name; fall back to token overlap.
  const teamMap = new Map<string, any>();
  for (const t of (tt || [])) {
    teamMap.set(normalizeTeam(t.full_name || ""), t);
    if (t.abbreviation) teamMap.set(normalizeTeam(t.abbreviation), t);
  }

  // ── Build insert payloads + flag unresolvable teams ────────────────
  step("Resolving teams for cohort");
  type Plan = { name: string; team: string; teamRow: any | null; payload: Row; sourceId: string; teamScore: number };
  const plans: Plan[] = [];
  for (const r of cohort) {
    const norm = normalizeTeam(r.team);
    let teamRow = teamMap.get(norm);
    let teamScore = teamRow ? 1.0 : 0;
    if (!teamRow) {
      // fuzzy fallback
      let best: any = null; let bestScore = 0;
      for (const t of (tt || [])) {
        const score = tokenOverlap(norm, normalizeTeam(t.full_name || ""));
        if (score > bestScore) { best = t; bestScore = score; }
      }
      if (bestScore >= 0.6) { teamRow = best; teamScore = bestScore; }
    }
    plans.push({ name: r.name, team: r.team, teamRow, payload: r, sourceId: syntheticSourceId(r.name, r.team), teamScore });
  }
  const resolved = plans.filter((p) => p.teamRow);
  const unresolved = plans.filter((p) => !p.teamRow);
  info(`Resolved: ${resolved.length} · Unresolved: ${unresolved.length}`);
  if (unresolved.length > 0) {
    warn("Unresolvable team names (will skip):");
    for (const u of unresolved.slice(0, 20)) console.log(`    ${u.name} — "${u.team}"`);
  }

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Sample plans:${COLOR.reset}`);
    for (const p of resolved.slice(0, 8)) {
      console.log(`    ${p.name.padEnd(28)} · ${p.team.padEnd(30)} → ${p.teamRow.full_name} (overlap ${p.teamScore.toFixed(2)})`);
      console.log(`        slash .${(p.payload.avg*1000).toFixed(0)}/.${(p.payload.obp*1000).toFixed(0)}/.${(p.payload.slg*1000).toFixed(0)}  PA=${p.payload.pa}  source_id=${p.sourceId}`);
    }
    console.log(`\nRe-run with --apply to insert ${resolved.length} new players.`);
    return;
  }

  warn(`This will INSERT ${resolved.length} new JUCO hitters (players + Hitter Master + player_predictions). Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Skip already-imported (idempotent re-run) ──────────────────────
  step("Checking for already-imported source_player_ids");
  const sourceIds = resolved.map((p) => p.sourceId);
  const already = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data } = await sb.from("players").select("source_player_id").in("source_player_id", sourceIds.slice(i, i + 100));
    for (const r of (data || [])) if (r.source_player_id) already.add(r.source_player_id);
  }
  const toInsert = resolved.filter((p) => !already.has(p.sourceId));
  info(`${already.size} already imported · ${toInsert.length} new to insert`);

  // ── Insert players rows ────────────────────────────────────────────
  step("Inserting players rows");
  const playerRows = toInsert.map((p) => {
    const { first, last } = splitName(p.name);
    return {
      id: randomUUID(),
      source_player_id: p.sourceId,
      first_name: first || p.name,
      last_name: last || "",
      team: p.teamRow.abbreviation || p.teamRow.full_name,
      team_id: p.teamRow.id,
      source_team_id: null,  // not tracked from Presto
      conference: p.teamRow.conference,
      division: "NJCAA_D1",
      transfer_portal: false,
      portal_status: "NOT IN PORTAL",
      is_twp: false,
      data_status: "partial",  // flagged for downstream awareness
    };
  });
  let playersDone = 0;
  for (let i = 0; i < playerRows.length; i += 100) {
    const chunk = playerRows.slice(i, i + 100);
    const { error } = await sb.from("players").insert(chunk);
    if (error) warn(`  players chunk @${i}: ${error.message}`);
    else playersDone += chunk.length;
  }
  ok(`Inserted ${playersDone} players rows`);

  // ── Insert Hitter Master rows ──────────────────────────────────────
  step("Inserting Hitter Master rows");
  const hmRows = toInsert.map((p) => ({
    source_player_id: p.sourceId,
    playerFullName: p.name.includes(",") ? `${p.name.split(",")[1].trim()} ${p.name.split(",")[0].trim()}` : p.name,
    Team: p.teamRow.abbreviation || p.teamRow.full_name,
    TeamID: p.teamRow.id,
    Conference: p.teamRow.conference,
    conference_id: p.teamRow.conference_id,
    Season: SEASON,
    AVG: p.payload.avg, OBP: p.payload.obp, SLG: p.payload.slg, ISO: p.payload.iso,
    pa: p.payload.pa,
    ab: prestoByKey.get(`${p.name}|${p.team}`)?.ab ?? null,
    bb: prestoByKey.get(`${p.name}|${p.team}`)?.bb ?? null,
    division: "NJCAA_D1",
    trackman_pitches: 0,  // no scouting data captured for these
  }));
  let hmDone = 0;
  for (let i = 0; i < hmRows.length; i += 100) {
    const chunk = hmRows.slice(i, i + 100);
    const { error } = await (sb as any).from("Hitter Master").insert(chunk);
    if (error) warn(`  HM chunk @${i}: ${error.message}`);
    else hmDone += chunk.length;
  }
  ok(`Inserted ${hmDone} Hitter Master rows`);

  // ── Insert player_predictions returner rows ────────────────────────
  step("Inserting player_predictions (returner-regular 2026)");
  // Need the player.id by source_player_id
  const idMap = new Map<string, string>();
  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100).map((p) => p.sourceId);
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const r of (data || [])) if (r.source_player_id) idMap.set(r.source_player_id, r.id);
  }
  const predRows = toInsert.filter((p) => idMap.has(p.sourceId)).map((p) => ({
    player_id: idMap.get(p.sourceId)!,
    model_type: "returner",
    variant: "regular",
    season: SEASON,
    status: "active",
    from_avg: p.payload.avg,
    from_obp: p.payload.obp,
    from_slg: p.payload.slg,
    class_transition: null,
    dev_aggressiveness: 0,
  }));
  let predDone = 0;
  for (let i = 0; i < predRows.length; i += 100) {
    const chunk = predRows.slice(i, i + 100);
    const { error } = await sb.from("player_predictions").insert(chunk);
    if (error) warn(`  pred chunk @${i}: ${error.message}`);
    else predDone += chunk.length;
  }
  ok(`Inserted ${predDone} player_predictions rows`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
