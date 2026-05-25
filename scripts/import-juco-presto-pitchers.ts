#!/usr/bin/env node
/**
 * Refresh JUCO pitcher stats from Presto Sports CSV.
 *
 * Presto pitcher export columns:
 *   Rank, Name, Team, ERA, W, L, APP, GS, SV, IP, H, R, ER, BB, K, K/9,
 *   HR, WHIP, BF, WP, HBP
 *
 * Derived fields (Presto doesn't provide these directly):
 *   BB/9 = BB × 9 / IP
 *   HR/9 = HR × 9 / IP
 *   FIP  = ((13×HR + 3×BB - 2×K) / IP) + FIP_CONST (3.10 college baseline)
 *
 * IP notation: Presto uses "X.Y" where Y is outs (0/1/2), not decimal
 * fraction. "90.1" = 90 + 1/3 = 90.333. Must convert before all rate
 * calculations.
 *
 * Match strategy: same three-tier as hitter import (HIGH = exact
 * normalized name+team OR unique name + team overlap >= 0.5).
 * HIGH rows update Pitching Master + cascade to player_predictions
 * (from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9).
 *
 * Usage:
 *   npm run import-presto-pitchers -- <path>                # dry-run
 *   npm run import-presto-pitchers -- <path> --apply        # write
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const CONFIRM = "yes-import-presto-pitchers";
// FIP constant is COMPUTED from the league below, not hardcoded.
// Standard FIP formula:
//   FIP = ((13×HR) + (3×(BB+HBP)) - (2×K)) / IP + FIP_const
// Constant ensures lgFIP = lgERA so the metric is unitless / comparable:
//   FIP_const = lgERA − (((13×lgHR) + (3×(lgBB+lgHBP)) − (2×lgK)) / lgIP)
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

// ── CSV parsing ──────────────────────────────────────────────────────
function parseCSVRow(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}

// ── IP conversion: "90.1" baseball notation → 90.333 decimal ─────────
function ipToDecimal(ip: string | number): number {
  const s = String(ip).trim();
  if (!s) return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10);
  // .1 → 1/3, .2 → 2/3, anything else treated as a real decimal already
  if (frac === 1) return whole + 1 / 3;
  if (frac === 2) return whole + 2 / 3;
  return n;
}

// ── Name + team normalization (mirrors hitter import) ────────────────
function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
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
  return s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokenOverlap(a: string, b: string): number {
  const aSet = new Set(a.split(" ").filter(Boolean));
  const bSet = new Set(b.split(" ").filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let common = 0; for (const t of aSet) if (bSet.has(t)) common++;
  return (2 * common) / (aSet.size + bSet.size);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath || !existsSync(csvPath)) {
    err("Usage: npm run import-presto-pitchers -- <csv-path> [--apply]");
    process.exit(1);
  }

  console.log(COLOR.bold + `\n══ Import JUCO Presto Pitchers ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const isProd = process.argv.includes("--prod");
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const lowerUrl = url.toLowerCase();
  const looksLikeProd = lowerUrl.includes("trbvxuoliwrfowibatkm") || lowerUrl.includes("ualmkgkdnoubccoieahf");
  if (looksLikeProd && !isProd) { err(`SUPABASE_URL looks like PROD but --prod was not passed. Refusing.`); process.exit(1); }
  if (isProd && !looksLikeProd) { err(`--prod passed but SUPABASE_URL doesn't look like prod. Refusing.`); process.exit(1); }
  if (!looksLikeProd && !lowerUrl.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL (slrxowawbijbjrkozqlj) or prod with --prod"); process.exit(1); }
  console.log(`Target DB: ${looksLikeProd ? COLOR.red + "PROD" + COLOR.reset : "staging"}`);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse pass 1: raw rows + league totals ─────────────────────────
  step("Parsing CSV (pass 1: extract + accumulate league totals)");
  const lines = readFileSync(csvPath, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  type PrestoRaw = {
    name: string; team: string;
    era: number; ip: number; h: number; r: number; er: number;
    bb: number; k: number; hr: number; whip: number; k9: number; hbp: number;
    w: number; l: number; app: number; gs: number; sv: number;
  };
  const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const raws: PrestoRaw[] = [];
  // League aggregates for FIP constant
  let lgIP = 0, lgBB = 0, lgHBP = 0, lgK = 0, lgHR = 0, lgER = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVRow(lines[i]);
    if (c.length < 21) continue;
    const ip = ipToDecimal(c[9]);
    if (ip <= 0) continue;
    const bb = num(c[13]);
    const k = num(c[14]);
    const hr = num(c[16]);
    const er = num(c[12]);
    const hbp = num(c[20]);  // last column in Presto pitcher export
    raws.push({
      name: c[1], team: c[2],
      era: num(c[3]), w: num(c[4]), l: num(c[5]), app: num(c[6]), gs: num(c[7]), sv: num(c[8]),
      ip, h: num(c[10]), r: num(c[11]), er, bb, k, k9: num(c[15]), hr, whip: num(c[17]), hbp,
    });
    lgIP += ip; lgBB += bb; lgHBP += hbp; lgK += k; lgHR += hr; lgER += er;
  }
  info(`${raws.length} Presto pitcher rows parsed (IP > 0)`);

  // ── Compute league FIP constant from the parsed cohort ─────────────
  // Standard formula: FIP_const = lgERA − ((13×lgHR + 3×(lgBB+lgHBP) − 2×lgK) / lgIP)
  // This makes lgFIP = lgERA by construction.
  const lgERA = (lgER * 9) / lgIP;
  const lgKwERA = ((13 * lgHR) + (3 * (lgBB + lgHBP)) - (2 * lgK)) / lgIP;
  const FIP_CONST = lgERA - lgKwERA;
  info(`League totals: IP=${lgIP.toFixed(0)}, BB=${lgBB}, HBP=${lgHBP}, K=${lgK}, HR=${lgHR}, ER=${lgER}`);
  info(`Derived: lgERA=${lgERA.toFixed(3)}, lgKwERA=${lgKwERA.toFixed(3)}, FIP_const=${FIP_CONST.toFixed(3)}`);

  // ── Pass 2: compute per-pitcher derived rates ──────────────────────
  type PrestoP = PrestoRaw & { bb9: number; hr9: number; fip: number };
  const presto: PrestoP[] = raws.map((r) => {
    const bb9 = (r.bb * 9) / r.ip;
    const hr9 = (r.hr * 9) / r.ip;
    const fip = ((13 * r.hr) + (3 * (r.bb + r.hbp)) - (2 * r.k)) / r.ip + FIP_CONST;
    return {
      ...r,
      bb9: Math.round(bb9 * 100) / 100,
      hr9: Math.round(hr9 * 100) / 100,
      fip: Math.round(fip * 100) / 100,
    };
  });

  // ── Pull existing JUCO 2026 Pitching Master rows ──────────────────
  step("Loading 2026 JUCO Pitching Master rows");
  const pm: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (sb as any)
      .from("Pitching Master")
      .select(`source_player_id, "playerFullName", "Team", "IP", "ERA", "FIP", "WHIP", "K9", "BB9", "HR9", stuff_plus`)
      .eq("division", "NJCAA_D1")
      .eq("Season", 2026)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    pm.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  info(`${pm.length} JUCO PM rows loaded`);

  // ── Build PM indexes ───────────────────────────────────────────────
  const pmByNameTeam = new Map<string, any[]>();
  for (const r of pm) {
    const k = `${normalizeName(r.playerFullName || "")}|${normalizeTeam(r.Team || "")}`;
    if (!pmByNameTeam.has(k)) pmByNameTeam.set(k, []);
    pmByNameTeam.get(k)!.push(r);
  }
  const pmByName = new Map<string, any[]>();
  for (const r of pm) {
    const k = normalizeName(r.playerFullName || "");
    if (!pmByName.has(k)) pmByName.set(k, []);
    pmByName.get(k)!.push(r);
  }

  // ── Three-tier match ───────────────────────────────────────────────
  step("Matching");
  type Result = { p: PrestoP; pm: any | null; tier: "HIGH" | "MEDIUM" | "NONE"; reason: string };
  const results: Result[] = [];
  for (const p of presto) {
    const pName = normalizeName(p.name);
    const pTeam = normalizeTeam(p.team);
    const key = `${pName}|${pTeam}`;

    let candidates = pmByNameTeam.get(key) || [];
    if (candidates.length === 1) {
      results.push({ p, pm: candidates[0], tier: "HIGH", reason: "exact name+team" }); continue;
    }
    if (candidates.length > 1) {
      const sorted = candidates.slice().sort((a, b) => Math.abs((a.IP ?? 0) - p.ip) - Math.abs((b.IP ?? 0) - p.ip));
      results.push({ p, pm: sorted[0], tier: "MEDIUM", reason: `${candidates.length} PM rows share name+team — picked closest IP` }); continue;
    }

    candidates = pmByName.get(pName) || [];
    if (candidates.length === 1) {
      const c = candidates[0];
      const teamScore = tokenOverlap(pTeam, normalizeTeam(c.Team || ""));
      if (teamScore >= 0.5) {
        results.push({ p, pm: c, tier: "HIGH", reason: `unique name + team overlap ${teamScore.toFixed(2)}` }); continue;
      }
      results.push({ p, pm: c, tier: "MEDIUM", reason: `unique name, team weak (overlap ${teamScore.toFixed(2)})` }); continue;
    }
    if (candidates.length > 1) {
      const scored = candidates.map((c) => ({ c, score: tokenOverlap(pTeam, normalizeTeam(c.Team || "")) }))
        .sort((a, b) => b.score - a.score);
      results.push({ p, pm: scored[0].c, tier: "MEDIUM", reason: `${candidates.length} same-name candidates, best overlap ${scored[0].score.toFixed(2)}` });
      continue;
    }

    results.push({ p, pm: null, tier: "NONE", reason: "no name match in 2026 JUCO PM" });
  }

  const high = results.filter((r) => r.tier === "HIGH");
  const medium = results.filter((r) => r.tier === "MEDIUM");
  const none = results.filter((r) => r.tier === "NONE");
  info(`HIGH: ${high.length} · MEDIUM: ${medium.length} · NONE: ${none.length}`);

  // ── Write review CSVs ─────────────────────────────────────────────
  const outDir = "/Users/danielleogonowski/RSTR IQ Data/juco-exploration";
  const mediumCsv = [
    "PrestoName,PrestoTeam,PrestoIP,PrestoERA,PM_Name,PM_Team,PM_IP,PM_ERA,Reason",
    ...medium.map((r) => [r.p.name, r.p.team, r.p.ip, r.p.era, r.pm?.playerFullName ?? "", r.pm?.Team ?? "", r.pm?.IP ?? "", r.pm?.ERA ?? "", r.reason].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  writeFileSync(`${outDir}/presto-pitcher-medium.csv`, mediumCsv);
  const noneCsv = ["PrestoName,PrestoTeam,PrestoIP,PrestoERA", ...none.map((r) => `"${r.p.name}","${r.p.team}",${r.p.ip.toFixed(1)},${r.p.era}`)].join("\n");
  writeFileSync(`${outDir}/presto-pitcher-none.csv`, noneCsv);
  info(`Wrote ${outDir}/presto-pitcher-medium.csv`);
  info(`Wrote ${outDir}/presto-pitcher-none.csv`);

  if (high.length > 0) {
    info(`\nSample HIGH matches (first 5):`);
    for (const r of high.slice(0, 5)) {
      const pmStat = `ERA ${r.pm.ERA ?? "-"} FIP ${r.pm.FIP ?? "-"} BB9 ${r.pm.BB9 ?? "-"} HR9 ${r.pm.HR9 ?? "-"} IP ${r.pm.IP ?? "-"}`;
      const pStat = `ERA ${r.p.era} FIP ${r.p.fip} BB9 ${r.p.bb9} HR9 ${r.p.hr9} IP ${r.p.ip.toFixed(1)}`;
      console.log(`    ${r.p.name.padEnd(28)} | PM: ${pmStat}\n        → Presto: ${pStat}`);
    }
  }

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Re-run with --apply.${COLOR.reset}`);
    return;
  }

  warn(`This will UPDATE ${high.length} Pitching Master rows + cascade to player_predictions. Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Apply Pitching Master updates ─────────────────────────────────
  step("Updating Pitching Master (HIGH only)");
  let pmDone = 0;
  const CONC = 25;
  for (let i = 0; i < high.length; i += CONC) {
    const chunk = high.slice(i, i + CONC);
    await Promise.all(chunk.map(async (r) => {
      const patch = {
        ERA: r.p.era, FIP: r.p.fip, WHIP: r.p.whip,
        K9: r.p.k9, BB9: r.p.bb9, HR9: r.p.hr9,
        IP: r.p.ip,
      };
      const { error } = await (sb as any).from("Pitching Master").update(patch).eq("source_player_id", r.pm.source_player_id).eq("Season", 2026);
      if (error) warn(`PM update ${r.pm.source_player_id}: ${error.message}`);
      else pmDone++;
    }));
  }
  ok(`Updated ${pmDone} Pitching Master rows`);

  // ── Cascade to player_predictions (returner-regular 2026) ─────────
  step("Cascading to player_predictions");
  const sourceIds = high.map((r) => r.pm.source_player_id).filter(Boolean);
  const sourceToPresto = new Map(high.map((r) => [r.pm.source_player_id, r.p]));
  const idMap = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunk = sourceIds.slice(i, i + 100);
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const p of (data || [])) if (p.source_player_id) idMap.set(p.source_player_id, p.id);
  }
  const playerIds = Array.from(idMap.values());
  const predRows: Array<{ id: string; source_player_id: string }> = [];
  for (let i = 0; i < playerIds.length; i += 100) {
    const chunk = playerIds.slice(i, i + 100);
    const { data } = await sb.from("player_predictions").select("id, player_id").in("player_id", chunk).eq("model_type", "returner").eq("variant", "regular").eq("season", 2026);
    for (const r of (data || [])) {
      for (const [sid, pid] of idMap) {
        if (pid === r.player_id) { predRows.push({ id: r.id, source_player_id: sid }); break; }
      }
    }
  }
  info(`Found ${predRows.length} matching prediction rows`);
  let predDone = 0;
  for (let i = 0; i < predRows.length; i += CONC) {
    const chunk = predRows.slice(i, i + CONC);
    await Promise.all(chunk.map(async (r) => {
      const p = sourceToPresto.get(r.source_player_id);
      if (!p) return;
      const { error } = await sb.from("player_predictions").update({
        from_era: p.era, from_fip: p.fip, from_whip: p.whip,
        from_k9: p.k9, from_bb9: p.bb9, from_hr9: p.hr9,
      }).eq("id", r.id);
      if (!error) predDone++;
    }));
  }
  ok(`Updated ${predDone} player_predictions rows`);

  // ── Cascade IP to players table ────────────────────────────────────
  // Precompute scripts filter JUCO pitchers by p.ip >= 20 — that column
  // must be in sync with accurate IP. Without this, the precompute filter
  // excludes every JUCO pitcher.
  step("Cascading IP to players table");
  let playersDone = 0;
  for (let i = 0; i < high.length; i += CONC) {
    const chunk = high.slice(i, i + CONC);
    await Promise.all(chunk.map(async (r) => {
      const playerId = idMap.get(r.pm.source_player_id);
      if (!playerId) return;
      const { error } = await sb.from("players").update({ ip: r.p.ip }).eq("id", playerId);
      if (!error) playersDone++;
    }));
  }
  ok(`Updated ${playersDone} players.ip`);

  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
