#!/usr/bin/env node
/**
 * Import Pull Air % into Hitter Master.
 *
 * CSV source: ~/RSTR IQ Data/inbox/2026 Pull Air %:DOB:Class Year.csv
 * (or whatever path is passed). Columns expected:
 *   playerId, playerFullName, newestTeamName, newestTeamLevel, PullAir%
 *
 * Match strategy: playerId → players.source_player_id → Hitter Master row
 * for the same source_player_id at SEASON=2026.
 *
 * After loading raw pull_air for all matched players, computes a percentile
 * rank within the imported population and writes pull_air_score.
 *
 * Display-only. Does not impact any projection / risk / market equations.
 *
 * Usage:
 *   npm run import-pull-air -- "<csv path>"             # dry-run, staging
 *   npm run import-pull-air -- "<csv path>" --apply     # write, staging
 *   npm run import-pull-air:prod -- "<csv path>" --apply # write, prod
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const SEASON = 2026;
const CONFIRM = "yes-import-pull-air";
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

function parseCSVRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const parsePct = (s: string): number | null => {
  if (!s || s === "-" || s === "") return null;
  const n = parseFloat(s.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
};

async function main() {
  const isProd = process.argv.includes("--prod");
  const apply = process.argv.includes("--apply");
  const csvPath = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
  if (!csvPath) { err("Usage: npm run import-pull-air -- <csv path> [--apply] [--prod]"); process.exit(1); }
  if (!existsSync(csvPath)) { err(`File not found: ${csvPath}`); process.exit(1); }

  console.log(COLOR.bold + `\n══ Import Pull Air % to Hitter Master ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = (process.env.SUPABASE_URL ?? "").toLowerCase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const looksLikeProd = url.includes("trbvxuoliwrfowibatkm") || url.includes("ualmkgkdnoubccoieahf");
  if (looksLikeProd && !isProd) { err("SUPABASE_URL looks like PROD but --prod not passed. Refusing."); process.exit(1); }
  if (isProd && !looksLikeProd) { err("--prod passed but SUPABASE_URL doesn't look like prod. Refusing."); process.exit(1); }
  if (!looksLikeProd && !url.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL or --prod against prod URL"); process.exit(1); }
  console.log(`Target DB: ${looksLikeProd ? COLOR.red + "PROD" + COLOR.reset : "staging"}`);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse CSV ────────────────────────────────────────────────────────
  step("Parsing CSV");
  const lines = readFileSync(csvPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) { err("CSV is empty"); process.exit(1); }
  const header = parseCSVRow(lines[0]);
  const playerIdCol = header.indexOf("playerId");
  const pullAirCol = header.indexOf("PullAir%");
  const nameCol = header.indexOf("playerFullName");
  if (playerIdCol < 0 || pullAirCol < 0) {
    err(`Required columns missing — playerId=${playerIdCol}, PullAir%=${pullAirCol}`);
    process.exit(1);
  }

  type Row = { sourceId: string; pullAir: number; name: string };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    const sourceId = (cells[playerIdCol] || "").trim();
    const pullAir = parsePct(cells[pullAirCol] || "");
    const name = (cells[nameCol] || "").trim();
    if (!sourceId || pullAir == null) continue;
    rows.push({ sourceId, pullAir, name });
  }
  info(`${rows.length} valid Pull Air % rows parsed (of ${lines.length - 1} CSV rows)`);

  // ── Compute population percentile ranks ──────────────────────────────
  step("Computing percentile ranks within imported population");
  const sorted = [...rows].map((r) => r.pullAir).sort((a, b) => a - b);
  const pctRank = (v: number): number => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < v) lo = mid + 1; else hi = mid;
    }
    return Math.round((lo / sorted.length) * 100);
  };
  type Patched = Row & { score: number };
  const patched: Patched[] = rows.map((r) => ({ ...r, score: pctRank(r.pullAir) }));
  info(`Population min=${sorted[0].toFixed(2)} max=${sorted[sorted.length - 1].toFixed(2)} median=${sorted[Math.floor(sorted.length / 2)].toFixed(2)}`);

  // ── Map source_player_id → Hitter Master row id for current season ───
  step("Resolving source_player_id → Hitter Master rows");
  const sourceIds = Array.from(new Set(patched.map((r) => r.sourceId)));
  const hmRowIdBySourceId = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const chunk = sourceIds.slice(i, i + CHUNK);
    const { data, error } = await (sb as any)
      .from("Hitter Master")
      .select("id, source_player_id")
      .eq("Season", SEASON)
      .in("source_player_id", chunk);
    if (error) { err(`HM lookup chunk @${i}: ${error.message}`); continue; }
    for (const r of (data || [])) if (r.source_player_id) hmRowIdBySourceId.set(r.source_player_id, r.id);
  }
  const matched = patched.filter((r) => hmRowIdBySourceId.has(r.sourceId));
  info(`${matched.length} / ${patched.length} matched to a 2026 Hitter Master row`);
  const unmatched = patched.length - matched.length;
  if (unmatched > 0) warn(`${unmatched} CSV rows had no matching Hitter Master 2026 row (will skip)`);

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Re-run with --apply.${COLOR.reset}`);
    if (matched.length > 0) {
      info(`Sample: ${matched[0].name} sourceId=${matched[0].sourceId} pullAir=${matched[0].pullAir}% score=${matched[0].score}`);
    }
    return;
  }

  warn(`Will UPDATE ${matched.length} Hitter Master rows on ${looksLikeProd ? "PROD" : "STAGING"}. Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Apply updates ────────────────────────────────────────────────────
  step("Updating Hitter Master");
  const CONC = 25;
  let done = 0;
  for (let i = 0; i < matched.length; i += CONC) {
    const chunk = matched.slice(i, i + CONC);
    await Promise.all(chunk.map(async (r) => {
      const rowId = hmRowIdBySourceId.get(r.sourceId);
      if (!rowId) return;
      const { error } = await (sb as any)
        .from("Hitter Master")
        .update({ pull_air: r.pullAir, pull_air_score: r.score })
        .eq("id", rowId);
      if (!error) done++;
      else warn(`update ${r.name}: ${error.message}`);
    }));
  }
  ok(`Updated ${done} Hitter Master rows`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
