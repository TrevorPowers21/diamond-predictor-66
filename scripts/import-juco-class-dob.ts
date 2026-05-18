#!/usr/bin/env node
/**
 * Import JUCO class_year + DOB into Hitter Master and Pitching Master.
 *
 * Source CSV columns (flexible — script auto-detects):
 *   name, team, class_year, dob
 *   OR
 *   source_player_id, class_year, dob
 *
 * dob accepts: ISO (YYYY-MM-DD), US (MM/DD/YYYY), or M/D/YYYY.
 * class_year normalized to FR / SO / JR / SR / GR uppercase.
 *
 * Match strategy (ID-first, name+team fallback):
 *   1. If source_player_id provided → direct match
 *   2. Else normalize name+team → lookup by (playerFullName, Team) in both
 *      Hitter Master and Pitching Master (a TWP arm appears in both).
 *
 * Writes both columns when a match is found. Idempotent — re-running with
 * the same CSV overwrites class/DOB with the same values.
 *
 * Usage:
 *   npm run import-juco-class-dob -- <csv path>           # dry-run
 *   npm run import-juco-class-dob -- <csv path> --apply   # write to staging
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const CONFIRM = "yes-import-juco-class-dob";
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

function stripDiacritics(s: string): string { return s.normalize("NFKD").replace(/[̀-ͯ]/g, ""); }
function normalizeName(raw: string): string {
  let s = stripDiacritics(raw).toLowerCase().trim();
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    s = `${first} ${last}`;
  }
  s = s.replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "");
  return s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeTeam(raw: string): string {
  let s = stripDiacritics(raw).toLowerCase().trim();
  s = s.replace(/\bcommunity college\b/g, "cc");
  s = s.replace(/\bjunior college\b/g, "jc");
  s = s.replace(/\bcollege\b/g, "");
  s = s.replace(/\buniversity\b/g, "");
  s = s.replace(/\bof\b/g, "");
  s = s.replace(/\bstate\b/g, "st");
  return s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseDob(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  // ISO: 2003-04-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // US: MM/DD/YYYY or M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

function normalizeClass(raw: string): string | null {
  const s = (raw || "").trim().toUpperCase().replace(/\.$/, "");
  if (!s) return null;
  if (s === "FR" || s === "FRESHMAN") return "FR";
  if (s === "SO" || s === "SOPHOMORE") return "SO";
  if (s === "JR" || s === "JUNIOR") return "JR";
  if (s === "SR" || s === "SENIOR") return "SR";
  if (s === "GR" || s === "GS" || s === "GRAD" || s === "GRADUATE") return "GR";
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath || !existsSync(csvPath)) {
    err("Usage: npm run import-juco-class-dob -- <csv path> [--apply]");
    process.exit(1);
  }

  console.log(COLOR.bold + `\n══ Import JUCO Class + DOB ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL — refusing to run on prod"); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse CSV ──────────────────────────────────────────────────────
  step("Parsing CSV");
  const lines = readFileSync(csvPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCSVRow(lines[0]).map((h) => h.trim().toLowerCase());
  const idxName = header.findIndex((h) => h === "name" || h === "player_name" || h === "playerfullname");
  const idxTeam = header.findIndex((h) => h === "team" || h === "newestteamname");
  // Presto exports use `playerId` as the source identifier; canonical D1 CSVs use source_player_id.
  const idxSid  = header.findIndex((h) => h === "source_player_id" || h === "playerid");
  const idxClass = header.findIndex((h) => h === "class_year" || h === "class" || h === "classyear");
  const idxDob = header.findIndex((h) => h === "dob" || h === "date_of_birth" || h === "birth_date");

  if (idxClass < 0 && idxDob < 0) {
    err("CSV must include at least one of: class_year, dob"); process.exit(1);
  }
  if (idxSid < 0 && (idxName < 0 || idxTeam < 0)) {
    err("CSV must include either source_player_id OR (name + team)"); process.exit(1);
  }

  type Row = { name: string; team: string; sourceId: string | null; classYear: string | null; dob: string | null };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVRow(lines[i]);
    if (c.length < header.length) continue;
    const classYear = idxClass >= 0 ? normalizeClass(c[idxClass]) : null;
    const dob = idxDob >= 0 ? parseDob(c[idxDob]) : null;
    if (classYear == null && dob == null) continue;
    rows.push({
      name: idxName >= 0 ? c[idxName] : "",
      team: idxTeam >= 0 ? c[idxTeam] : "",
      sourceId: idxSid >= 0 ? (c[idxSid] || null) : null,
      classYear, dob,
    });
  }
  info(`${rows.length} CSV rows with class and/or DOB`);

  // ── Build name+team → source_player_id index from Hitter+Pitching Master ─
  step("Building name+team index from Hitter Master + Pitching Master");
  const nameTeamToSid = new Map<string, string>();
  for (const table of ["Hitter Master", "Pitching Master"] as const) {
    let from = 0;
    while (true) {
      const { data, error } = await (sb as any).from(table)
        .select(`source_player_id, "playerFullName", Team`)
        .eq("Season", SEASON)
        .eq("division", "NJCAA_D1")
        .range(from, from + 999);
      if (error) { warn(`${table}: ${error.message}`); break; }
      for (const r of (data || []) as any[]) {
        const key = `${normalizeName(r.playerFullName || "")}|${normalizeTeam(r.Team || "")}`;
        if (key !== "|" && r.source_player_id) nameTeamToSid.set(key, r.source_player_id);
      }
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  info(`${nameTeamToSid.size} JUCO (name, team) → source_player_id mappings`);

  // ── Resolve each row to a source_player_id ─────────────────────────
  type Plan = { row: Row; sourceId: string; hmHit: boolean; pmHit: boolean };
  const plans: Plan[] = [];
  const unresolved: Row[] = [];
  // Pre-check which source_player_ids exist in HM vs PM
  const allCandidateIds = new Set<string>();
  for (const r of rows) {
    let sid = r.sourceId;
    if (!sid) {
      const k = `${normalizeName(r.name)}|${normalizeTeam(r.team)}`;
      sid = nameTeamToSid.get(k) ?? null;
    }
    if (sid) {
      allCandidateIds.add(sid);
      plans.push({ row: r, sourceId: sid, hmHit: false, pmHit: false });
    } else {
      unresolved.push(r);
    }
  }
  // Check existence in HM
  const hmIds = new Set<string>();
  const pmIds = new Set<string>();
  const idList = Array.from(allCandidateIds);
  for (let i = 0; i < idList.length; i += 200) {
    const chunk = idList.slice(i, i + 200);
    const [{ data: hm }, { data: pm }] = await Promise.all([
      (sb as any).from("Hitter Master").select("source_player_id").eq("Season", SEASON).in("source_player_id", chunk),
      (sb as any).from("Pitching Master").select("source_player_id").eq("Season", SEASON).in("source_player_id", chunk),
    ]);
    for (const r of (hm || []) as any[]) hmIds.add(r.source_player_id);
    for (const r of (pm || []) as any[]) pmIds.add(r.source_player_id);
  }
  for (const p of plans) {
    p.hmHit = hmIds.has(p.sourceId);
    p.pmHit = pmIds.has(p.sourceId);
  }
  const onlyHm = plans.filter((p) => p.hmHit && !p.pmHit).length;
  const onlyPm = plans.filter((p) => !p.hmHit && p.pmHit).length;
  const both = plans.filter((p) => p.hmHit && p.pmHit).length;
  const neither = plans.filter((p) => !p.hmHit && !p.pmHit).length;
  info(`Resolved: ${plans.length} · Unresolved (no name+team match): ${unresolved.length}`);
  info(`  Hitter-only: ${onlyHm} · Pitcher-only: ${onlyPm} · TWP (both): ${both} · Neither table: ${neither}`);

  if (unresolved.length > 0 && unresolved.length <= 20) {
    warn("Unresolved rows:");
    for (const r of unresolved) console.log(`    ${r.name} — "${r.team}"`);
  }

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Sample plans:${COLOR.reset}`);
    for (const p of plans.slice(0, 6)) {
      console.log(`    ${p.row.name.padEnd(28)} | ${p.row.team.padEnd(28)} | class=${p.row.classYear ?? "—"} dob=${p.row.dob ?? "—"} | HM=${p.hmHit?"✓":"·"} PM=${p.pmHit?"✓":"·"}`);
    }
    console.log(`\nRe-run with --apply to write to staging.`);
    return;
  }

  warn(`This will UPDATE Hitter Master + Pitching Master class_year / dob for ${plans.length} rows. Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Write updates ──────────────────────────────────────────────────
  step("Writing updates");
  let hmUpdated = 0, pmUpdated = 0;
  for (const p of plans) {
    const patch: Record<string, any> = {};
    if (p.row.classYear != null) patch.class_year = p.row.classYear;
    if (p.row.dob != null) patch.dob = p.row.dob;
    if (Object.keys(patch).length === 0) continue;
    if (p.hmHit) {
      const { error } = await (sb as any).from("Hitter Master").update(patch).eq("source_player_id", p.sourceId).eq("Season", SEASON);
      if (error) warn(`HM ${p.sourceId}: ${error.message}`); else hmUpdated++;
    }
    if (p.pmHit) {
      const { error } = await (sb as any).from("Pitching Master").update(patch).eq("source_player_id", p.sourceId).eq("Season", SEASON);
      if (error) warn(`PM ${p.sourceId}: ${error.message}`); else pmUpdated++;
    }
  }
  ok(`Updated ${hmUpdated} Hitter Master rows · ${pmUpdated} Pitching Master rows`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
