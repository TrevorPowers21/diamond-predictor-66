#!/usr/bin/env node
/**
 * Add JUCO pitchers that exist in Presto Sports but are missing from
 * staging Pitching Master. Sourced from presto-pitcher-none.csv produced
 * by import-juco-presto-pitchers.ts.
 *
 * Cohort: IP ≥ 20 (matches the sim qualifier).
 *
 * For each new pitcher we insert:
 *   1. players row — UUID, division=NJCAA_D1, source_player_id=presto-<sha1>
 *   2. Pitching Master row — same source_player_id, ERA/FIP/WHIP/K9/BB9/HR9
 *      computed from Presto raw fields, BF, IP, G, GS, Role (inferred from
 *      GS/G ratio), Team / TeamID / Conference / conference_id resolved from
 *      Teams Table.
 *   3. player_predictions row — model_type=returner variant=regular season=2026
 *      with from_era/fip/whip/k9/bb9/hr9 and pitcher_role.
 *
 * If the synthetic source_player_id already exists in HITTER cohort (TWP arm),
 * UPDATE that player_predictions row with the pitcher fields rather than
 * inserting a duplicate. Mirrors backfill-juco-pitcher-predictions TWP path.
 *
 * FIP formula uses league-derived constant locked at 5.109 for JUCO 2026
 * (see import-juco-presto-pitchers.ts). Hardcoded here because the constant
 * is league-stable and recomputing requires the full Presto league CSV.
 *
 * Synthetic source_player_id format: `presto-<sha1(name+team)[:16]>` —
 * SAME hash function as add-presto-missing-hitters so a TWP arm shows up
 * with the same id on both sides.
 *
 * Usage:
 *   npm run add-presto-missing-pitchers -- <none.csv path>             # dry-run
 *   npm run add-presto-missing-pitchers -- <path> --apply              # write
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const CONFIRM = "yes-add-presto-missing-pitchers";
const IP_THRESHOLD = 20;
const SEASON = 2026;
const FIP_CONST = 5.109; // JUCO 2026 league-derived (locked, see import-juco-presto-pitchers.ts)
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

// ── IP: "90.1" baseball notation → 90.333 decimal ────────────────────
function ipToDecimal(ip: string | number): number {
  const s = String(ip).trim();
  if (!s) return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10);
  if (frac === 1) return whole + 1 / 3;
  if (frac === 2) return whole + 2 / 3;
  return n;
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
  if (presto.includes(",")) {
    const [last, first] = presto.split(",").map((s) => s.trim());
    return { first, last };
  }
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
    err("Usage: npm run add-presto-missing-pitchers -- <none.csv path> [--apply]");
    process.exit(1);
  }

  console.log(COLOR.bold + `\n══ Add Presto Missing JUCO Pitchers ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  // Allow staging OR prod. Print which DB we're hitting so the operator
  // can sanity-check before confirming with the typed phrase.
  const isStaging = url.includes("slrxowawbijbjrkozqlj");
  const isProd = url.includes("trbvxuoliwrfowibatkm");
  if (!isStaging && !isProd) { err(`Unknown Supabase URL: ${url}`); process.exit(1); }
  console.log(`Target DB: ${isProd ? COLOR.red + "PROD" + COLOR.reset : "staging"} (${url})`);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse none.csv (just gives us name + team) ─────────────────────
  step("Parsing none.csv");
  const lines = readFileSync(csvPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  type NoneRow = { name: string; team: string; ip: number; era: number };
  const noneRows: NoneRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    if (cells.length < 4) continue;
    noneRows.push({
      name: cells[0],
      team: cells[1],
      ip: ipToDecimal(cells[2]),
      era: Number(cells[3]) || 0,
    });
  }
  info(`${noneRows.length} total NONE rows`);
  const aboveIp = noneRows.filter((r) => r.ip >= IP_THRESHOLD);
  info(`${aboveIp.length} qualify (IP ≥ ${IP_THRESHOLD})`);

  // ── Re-read full Presto pitching CSV for K/BB/HR/HBP/BF ─────────────
  step("Re-reading full Presto pitching CSV for raw counts");
  const fullCsv = "/Users/danielleogonowski/RSTR IQ Data/juco-exploration/2026 JUCO Stats - Pitching Main 051826.csv";
  if (!existsSync(fullCsv)) { err(`Full Presto pitching CSV not found at ${fullCsv}`); process.exit(1); }
  const fullLines = readFileSync(fullCsv, "utf-8").split(/\r?\n/).filter((l) => l.trim());
  // Header: Rank,Name,Team,ERA,W,L,APP,GS,SV,IP,H,R,ER,BB,K,K/9,HR,WHIP,BF,WP,HBP
  type Full = { era: number; app: number; gs: number; ip: number; h: number; bb: number; k: number; k9: number; hr: number; whip: number; bf: number; hbp: number };
  const fullByKey = new Map<string, Full>();
  for (let i = 1; i < fullLines.length; i++) {
    const c = parseCSVRow(fullLines[i]);
    if (c.length < 21) continue;
    const key = `${c[1]}|${c[2]}`;
    fullByKey.set(key, {
      era: Number(c[3]) || 0, app: Number(c[6]) || 0, gs: Number(c[7]) || 0,
      ip: ipToDecimal(c[9]), h: Number(c[10]) || 0, bb: Number(c[13]) || 0, k: Number(c[14]) || 0,
      k9: Number(c[15]) || 0, hr: Number(c[16]) || 0, whip: Number(c[17]) || 0,
      bf: Number(c[18]) || 0, hbp: Number(c[20]) || 0,
    });
  }

  // ── Hydrate cohort with full Presto raw counts + compute rates ──────
  type Row = NoneRow & { app: number; gs: number; h: number; bb: number; k: number; hr: number; bf: number; hbp: number; whip: number; k9: number; bb9: number; hr9: number; fip: number; role: "SP" | "RP" };
  const cohort: Row[] = [];
  let missingFull = 0;
  for (const r of aboveIp) {
    const full = fullByKey.get(`${r.name}|${r.team}`);
    if (!full) { missingFull++; continue; }
    const ip = full.ip;
    if (ip < IP_THRESHOLD) continue;
    const k9 = full.k9 > 0 ? full.k9 : ip > 0 ? (full.k * 9) / ip : 0;
    const bb9 = ip > 0 ? (full.bb * 9) / ip : 0;
    const hr9 = ip > 0 ? (full.hr * 9) / ip : 0;
    const fip = ip > 0
      ? ((13 * full.hr + 3 * (full.bb + full.hbp) - 2 * full.k) / ip) + FIP_CONST
      : 0;
    const role: "SP" | "RP" = full.app > 0 && full.gs / full.app >= 0.5 ? "SP" : "RP";
    cohort.push({
      ...r, app: full.app, gs: full.gs, h: full.h, bb: full.bb, k: full.k,
      hr: full.hr, bf: full.bf, hbp: full.hbp, whip: full.whip,
      k9: Math.round(k9 * 100) / 100, bb9: Math.round(bb9 * 100) / 100,
      hr9: Math.round(hr9 * 100) / 100, fip: Math.round(fip * 100) / 100, role,
    });
  }
  if (missingFull > 0) warn(`${missingFull} cohort rows missing from full Presto CSV — skipped`);
  info(`${cohort.length} pitchers hydrated with raw counts + derived rates`);

  // ── Resolve team → Teams Table row ─────────────────────────────────
  step("Loading Teams Table (2026)");
  const { data: tt } = await (sb as any)
    .from("Teams Table")
    .select("id, full_name, abbreviation, conference, conference_id, district")
    .eq("Season", SEASON)
    .eq("division", "NJCAA_D1");
  info(`${tt?.length ?? 0} JUCO Teams Table 2026 rows loaded`);
  const teamMap = new Map<string, any>();
  for (const t of (tt || [])) {
    teamMap.set(normalizeTeam(t.full_name || ""), t);
    if (t.abbreviation) teamMap.set(normalizeTeam(t.abbreviation), t);
  }

  // ── Build insert plans + flag unresolvable teams ───────────────────
  step("Resolving teams for cohort");
  type Plan = { name: string; team: string; teamRow: any | null; payload: Row; sourceId: string; teamScore: number };
  const plans: Plan[] = [];
  for (const r of cohort) {
    const norm = normalizeTeam(r.team);
    let teamRow = teamMap.get(norm);
    let teamScore = teamRow ? 1.0 : 0;
    if (!teamRow) {
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
      console.log(`        ${p.payload.role}  IP=${p.payload.ip.toFixed(1)}  ERA=${p.payload.era}  FIP=${p.payload.fip}  WHIP=${p.payload.whip}  K/9=${p.payload.k9}  BB/9=${p.payload.bb9}  HR/9=${p.payload.hr9}`);
      console.log(`        source_id=${p.sourceId}`);
    }
    console.log(`\nRe-run with --apply to insert ${resolved.length} new pitchers.`);
    return;
  }

  warn(`This will INSERT/UPDATE ${resolved.length} JUCO pitchers (players + Pitching Master + player_predictions). Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Idempotency: skip players already imported (presto-* match) ─────
  step("Checking for already-imported source_player_ids");
  const sourceIds = resolved.map((p) => p.sourceId);
  const existingPlayer = new Map<string, string>(); // source_player_id → player.id
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", sourceIds.slice(i, i + 100));
    for (const r of (data || [])) if (r.source_player_id) existingPlayer.set(r.source_player_id, r.id);
  }
  const toInsertPlayer = resolved.filter((p) => !existingPlayer.has(p.sourceId));
  const twpExisting = resolved.filter((p) => existingPlayer.has(p.sourceId));
  info(`${existingPlayer.size} already exist (likely TWP from hitter add-new) · ${toInsertPlayer.length} fresh inserts`);

  // ── Insert new players rows ────────────────────────────────────────
  step("Inserting players rows (fresh only)");
  const playerRows = toInsertPlayer.map((p) => {
    const { first, last } = splitName(p.name);
    return {
      id: randomUUID(),
      source_player_id: p.sourceId,
      first_name: first || p.name,
      last_name: last || "",
      team: p.teamRow.abbreviation || p.teamRow.full_name,
      team_id: p.teamRow.id,
      source_team_id: null,
      conference: p.teamRow.conference,
      division: "NJCAA_D1",
      transfer_portal: false,
      portal_status: "NOT IN PORTAL",
      is_twp: false,
      data_status: "partial",
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

  // Re-resolve so we have the player.id for everyone (incl. just-inserted)
  const allIds = new Map<string, string>(existingPlayer);
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", sourceIds.slice(i, i + 100));
    for (const r of (data || [])) if (r.source_player_id) allIds.set(r.source_player_id, r.id);
  }

  // ── Insert Pitching Master rows (only for plans that don't already have one) ─
  step("Inserting Pitching Master rows");
  // Check which source_player_ids already have a 2026 PM row (e.g., TWP arm already has hitter-side
  // skeleton — we still want a PM row, so this filters duplicates not skips fresh inserts).
  const existingPm = new Set<string>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const { data } = await (sb as any).from("Pitching Master")
      .select("source_player_id")
      .eq("Season", SEASON)
      .in("source_player_id", sourceIds.slice(i, i + 100));
    for (const r of (data || [])) if (r.source_player_id) existingPm.add(r.source_player_id);
  }
  const pmToInsert = resolved.filter((p) => !existingPm.has(p.sourceId));
  info(`${existingPm.size} already have Pitching Master row · ${pmToInsert.length} to insert`);
  const pmRows = pmToInsert.map((p) => {
    const fullName = p.name.includes(",")
      ? `${p.name.split(",")[1].trim()} ${p.name.split(",")[0].trim()}`
      : p.name;
    return {
      source_player_id: p.sourceId,
      playerFullName: fullName,
      Team: p.teamRow.abbreviation || p.teamRow.full_name,
      TeamID: p.teamRow.id,
      Conference: p.teamRow.conference,
      conference_id: p.teamRow.conference_id,
      Season: SEASON,
      ThrowHand: null, // Presto doesn't carry handedness
      Role: p.payload.role,
      IP: p.payload.ip,
      G: p.payload.app,
      GS: p.payload.gs,
      ERA: p.payload.era,
      FIP: p.payload.fip,
      WHIP: p.payload.whip,
      K9: p.payload.k9,
      BB9: p.payload.bb9,
      HR9: p.payload.hr9,
      bf: p.payload.bf,
      trackman_pitches: 0,
      division: "NJCAA_D1",
    };
  });
  let pmDone = 0;
  for (let i = 0; i < pmRows.length; i += 100) {
    const chunk = pmRows.slice(i, i + 100);
    const { error } = await (sb as any).from("Pitching Master").insert(chunk);
    if (error) warn(`  PM chunk @${i}: ${error.message}`);
    else pmDone += chunk.length;
  }
  ok(`Inserted ${pmDone} Pitching Master rows`);

  // ── Player predictions: INSERT fresh OR UPDATE existing TWP ─────────
  step("Inserting / updating player_predictions");
  type Update = { id: string; patch: any };
  const inserts: any[] = [];
  const updates: Update[] = [];
  // Pre-fetch existing returner-regular rows to spot TWP
  const playerIds = Array.from(allIds.values());
  const existingPred = new Map<string, { id: string; from_era: number | null }>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const { data } = await sb.from("player_predictions")
      .select("id, player_id, from_era")
      .in("player_id", playerIds.slice(i, i + 100))
      .eq("model_type", "returner").eq("variant", "regular").eq("season", SEASON);
    for (const r of (data || [])) existingPred.set(r.player_id, { id: r.id, from_era: r.from_era });
  }
  for (const p of resolved) {
    const playerId = allIds.get(p.sourceId);
    if (!playerId) continue;
    const pitcherFields = {
      from_era: p.payload.era, from_fip: p.payload.fip, from_whip: p.payload.whip,
      from_k9: p.payload.k9, from_bb9: p.payload.bb9, from_hr9: p.payload.hr9,
      from_stuff_plus_self: null, // Presto-only — no TrackMan capture
      pitcher_role: p.payload.role,
    };
    const existing = existingPred.get(playerId);
    if (existing) {
      if (existing.from_era != null) continue; // already has pitcher data
      updates.push({ id: existing.id, patch: pitcherFields });
    } else {
      inserts.push({
        player_id: playerId, model_type: "returner", variant: "regular", season: SEASON,
        status: "active", class_transition: null, dev_aggressiveness: 0, ...pitcherFields,
      });
    }
  }
  info(`${inserts.length} pred inserts · ${updates.length} TWP pred updates`);
  let predIns = 0;
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    const { error } = await sb.from("player_predictions").insert(chunk);
    if (error) warn(`  pred insert @${i}: ${error.message}`);
    else predIns += chunk.length;
  }
  ok(`Inserted ${predIns} pred rows`);
  let predUpd = 0;
  for (const u of updates) {
    const { error } = await sb.from("player_predictions").update(u.patch).eq("id", u.id);
    if (error) warn(`  pred update ${u.id}: ${error.message}`);
    else predUpd++;
  }
  ok(`Updated ${predUpd} TWP pred rows`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
