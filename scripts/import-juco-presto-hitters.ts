#!/usr/bin/env node
/**
 * Import 2026 JUCO hitter stats from a Presto Sports CSV export.
 *
 * Source: njcaastats.prestosports.com — official NJCAA stat feed.
 * Purpose: replace TruMedia-sourced 2026 JUCO triple-slash / PA / AB / H /
 * RBI / BB / K with Presto values. TruMedia was undercounting JUCO PA by
 * ~10-30% and consequently overstating slash rates.
 *
 * Match strategy (three tiers):
 *   HIGH    — normalized name+team match AND PA within ±10% of HM row
 *   MEDIUM  — name+team match but PA differs >10% OR fuzzy name match
 *   NONE    — no candidate found
 *
 * Only HIGH rows auto-update Hitter Master + player_predictions.from_*.
 * MEDIUM rows go to a review CSV for manual triage.
 *
 * Usage:
 *   npm run import-presto-hitters -- "<path/to/csv>"             # dry-run
 *   npm run import-presto-hitters -- "<path>" --apply            # write
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const CONFIRM = "yes-import-presto-hitters";
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

// ── CSV parsing ──────────────────────────────────────────────────────
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

// ── Name + team normalization ────────────────────────────────────────
function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}
function normalizeName(raw: string): string {
  let s = stripDiacritics(raw).toLowerCase().trim();
  // Convert "Last, First" → "first last"
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    s = `${first} ${last}`;
  }
  // Strip suffixes
  s = s.replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "");
  // Collapse whitespace, drop non-alphanum
  return s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeTeam(raw: string): string {
  let s = stripDiacritics(raw).toLowerCase().trim();
  // Institutional acronym aliases — Presto uses official names, HM often
  // shortens them. Apply BEFORE the generic strip-words pass.
  s = s.replace(/\busc\b/g, "south carolina");                       // USC X = South Carolina X
  s = s.replace(/\blsu\b/g, "louisiana state university");           // LSU Eunice = Louisiana State University Eunice
  s = s.replace(/\bnmmi\b/g, "new mexico military institute");
  s = s.replace(/\bnjc\b/g, "new mexico junior");
  s = s.replace(/\bwvu\b/g, "west virginia");
  s = s.replace(/\belaine p\.? nunez\b/g, "nunez");                  // HM: Elaine P. Nunez = Presto: Nunez CC
  s = s.replace(/\btallahassee state\b/g, "tallahassee");            // State vs CC interchangeable on Presto export
  s = s.replace(/\bgrayson county\b/g, "grayson");                   // HM: Grayson County, Presto: Grayson
  s = s.replace(/\bsouthern idaho \(jc\)\b/g, "southern idaho");
  s = s.replace(/\bcollege of southern idaho\b/g, "southern idaho");
  // Common substring substitutions
  s = s.replace(/\bcommunity college\b/g, "cc");
  s = s.replace(/\bjunior college\b/g, "jc");
  s = s.replace(/\bcollege\b/g, "");
  s = s.replace(/\buniversity\b/g, "");
  s = s.replace(/\bof\b/g, "");
  s = s.replace(/\bstate\b/g, "st");
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
// Token-set overlap score (0..1) — handles word reordering / extras
function tokenOverlap(a: string, b: string): number {
  const aSet = new Set(a.split(" ").filter(Boolean));
  const bSet = new Set(b.split(" ").filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let common = 0;
  for (const t of aSet) if (bSet.has(t)) common++;
  return (2 * common) / (aSet.size + bSet.size);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const csvPath = args.find((a) => !a.startsWith("--"));
  if (!csvPath) { err("Usage: npm run import-presto-hitters -- <csv-path> [--apply]"); process.exit(1); }
  if (!existsSync(csvPath)) { err(`File not found: ${csvPath}`); process.exit(1); }

  console.log(COLOR.bold + `\n══ Import JUCO Presto Hitters ══` + COLOR.reset);
  console.log(`Source: ${csvPath}`);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL"); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Parse CSV ──────────────────────────────────────────────────────
  step("Parsing CSV");
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  info(`${lines.length} total lines (incl. header)`);
  type PrestoRow = {
    rank: string; name: string; team: string;
    gp: number; ab: number; h: number; rbi: number; bb: number; k: number;
    avg: number; obp: number; slg: number; pa: number; iso: number;
    raw: string;
  };
  const presto: PrestoRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    if (cells.length < 20) continue;
    const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const avg = num(cells[9]); const slg = num(cells[11]);
    presto.push({
      rank: cells[0],
      name: cells[1],
      team: cells[2],
      gp: num(cells[3]),
      ab: num(cells[4]),
      h: num(cells[5]),
      rbi: num(cells[6]),
      bb: num(cells[7]),
      k: num(cells[8]),
      avg,
      obp: num(cells[10]),
      slg,
      pa: num(cells[19]),
      iso: Math.round((slg - avg) * 1000) / 1000,
      raw: lines[i],
    });
  }
  info(`${presto.length} Presto data rows parsed`);

  // ── Pull existing JUCO 2026 Hitter Master rows ────────────────────
  step("Loading 2026 JUCO Hitter Master rows");
  const hm: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await (sb as any)
      .from("Hitter Master")
      .select(`source_player_id, "playerFullName", "Team", "AVG", "OBP", "SLG", "ISO", pa, ab`)
      .eq("division", "NJCAA_D1")
      .eq("Season", 2026)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    hm.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  info(`${hm.length} JUCO HM rows loaded`);

  // ── Build HM lookup indexes ────────────────────────────────────────
  const hmByNameTeam = new Map<string, any[]>();
  for (const r of hm) {
    const k = `${normalizeName(r.playerFullName || "")}|${normalizeTeam(r.Team || "")}`;
    if (!hmByNameTeam.has(k)) hmByNameTeam.set(k, []);
    hmByNameTeam.get(k)!.push(r);
  }
  const hmByName = new Map<string, any[]>();
  for (const r of hm) {
    const k = normalizeName(r.playerFullName || "");
    if (!hmByName.has(k)) hmByName.set(k, []);
    hmByName.get(k)!.push(r);
  }

  // ── Three-tier match ───────────────────────────────────────────────
  step("Matching");
  type MatchResult = { presto: PrestoRow; hm: any | null; tier: "HIGH" | "MEDIUM" | "NONE"; reason: string };
  const results: MatchResult[] = [];

  for (const p of presto) {
    const pName = normalizeName(p.name);
    const pTeam = normalizeTeam(p.team);
    const key = `${pName}|${pTeam}`;

    // Tier 1: exact name+team → HIGH regardless of PA delta. The PA
    // correction IS the point of this import, so a 30%+ delta is the
    // expected signal of a TruMedia undercount, not evidence of a wrong
    // match. PA tolerance only matters when there are MULTIPLE candidates.
    let candidates = hmByNameTeam.get(key) || [];
    if (candidates.length === 1) {
      results.push({ presto: p, hm: candidates[0], tier: "HIGH", reason: "exact name+team" }); continue;
    }
    if (candidates.length > 1) {
      // Multiple HM rows share name+team — use PA closeness to pick.
      const sorted = candidates.slice().sort((a, b) => Math.abs((a.pa ?? 0) - p.pa) - Math.abs((b.pa ?? 0) - p.pa));
      results.push({ presto: p, hm: sorted[0], tier: "MEDIUM", reason: `${candidates.length} HM rows share name+team — picked closest PA` }); continue;
    }

    // Tier 2: same name (uniquely), fuzzy team — uniqueness of the name
    // itself is strong evidence; bar the worst team mismatches and HIGH.
    candidates = hmByName.get(pName) || [];
    if (candidates.length === 1) {
      const c = candidates[0];
      const teamScore = tokenOverlap(pTeam, normalizeTeam(c.Team || ""));
      if (teamScore >= 0.5) {
        results.push({ presto: p, hm: c, tier: "HIGH", reason: `unique name + team overlap ${teamScore.toFixed(2)}` }); continue;
      }
      results.push({ presto: p, hm: c, tier: "MEDIUM", reason: `unique name, team weak (overlap ${teamScore.toFixed(2)})` }); continue;
    }
    if (candidates.length > 1) {
      const scored = candidates.map((c) => ({ c, score: tokenOverlap(pTeam, normalizeTeam(c.Team || "")) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      results.push({ presto: p, hm: best.c, tier: "MEDIUM", reason: `${candidates.length} same-name candidates, best team overlap ${best.score.toFixed(2)}` });
      continue;
    }

    results.push({ presto: p, hm: null, tier: "NONE", reason: "no name match in 2026 JUCO HM" });
  }

  const high = results.filter((r) => r.tier === "HIGH");
  const medium = results.filter((r) => r.tier === "MEDIUM");
  const none = results.filter((r) => r.tier === "NONE");
  info(`HIGH: ${high.length} · MEDIUM: ${medium.length} · NONE: ${none.length}`);

  // ── Write review CSVs ──────────────────────────────────────────────
  const outDir = "/Users/danielleogonowski/RSTR IQ Data/juco-exploration";
  const mediumCsv = [
    "PrestoName,PrestoTeam,PrestoPA,PrestoAVG,PrestoOBP,PrestoSLG,HM_Name,HM_Team,HM_PA,HM_AVG,HM_Reason",
    ...medium.map((r) => [r.presto.name, r.presto.team, r.presto.pa, r.presto.avg, r.presto.obp, r.presto.slg,
      r.hm?.playerFullName ?? "", r.hm?.Team ?? "", r.hm?.pa ?? "", r.hm?.AVG ?? "", r.reason].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  writeFileSync(`${outDir}/presto-import-medium.csv`, mediumCsv);
  const noneCsv = ["PrestoName,PrestoTeam,PrestoPA,PrestoAVG", ...none.map((r) => `"${r.presto.name}","${r.presto.team}",${r.presto.pa},${r.presto.avg}`)].join("\n");
  writeFileSync(`${outDir}/presto-import-none.csv`, noneCsv);
  info(`Wrote ${outDir}/presto-import-medium.csv`);
  info(`Wrote ${outDir}/presto-import-none.csv`);

  // ── Sample HIGH match preview ──────────────────────────────────────
  if (high.length > 0) {
    info(`\nSample HIGH matches (first 5):`);
    for (const r of high.slice(0, 5)) {
      const hmSlash = `${r.hm.AVG ?? "-"}/${r.hm.OBP ?? "-"}/${r.hm.SLG ?? "-"} PA${r.hm.pa ?? "-"}`;
      const pSlash = `${r.presto.avg}/${r.presto.obp}/${r.presto.slg} PA${r.presto.pa}`;
      console.log(`    ${r.presto.name.padEnd(28)} | HM: ${hmSlash.padEnd(28)} → Presto: ${pSlash}`);
    }
  }

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Review medium.csv + none.csv, then re-run with --apply.${COLOR.reset}`);
    return;
  }

  warn(`This will UPDATE ${high.length} Hitter Master rows + matching player_predictions. Type "${CONFIRM}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question("> ")).trim();
  rl.close();
  if (ans !== CONFIRM) { err("Aborted."); process.exit(1); }

  // ── Apply HIGH updates ─────────────────────────────────────────────
  step("Updating Hitter Master (HIGH only)");
  let hmDone = 0;
  const CONCURRENCY = 25;
  for (let i = 0; i < high.length; i += CONCURRENCY) {
    const chunk = high.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (r) => {
      // Only update columns that actually exist on Hitter Master.
      // GP/H/RBI/K aren't stored in HM — they live in Presto only and
      // would need a schema change to land. Triple slash + PA + AB + BB
      // is all the sim consumes; that's what we refresh.
      const patch = {
        AVG: r.presto.avg, OBP: r.presto.obp, SLG: r.presto.slg, ISO: r.presto.iso,
        ab: r.presto.ab, bb: r.presto.bb, pa: r.presto.pa,
      };
      const { error } = await (sb as any).from("Hitter Master").update(patch).eq("source_player_id", r.hm.source_player_id).eq("Season", 2026);
      if (error) warn(`HM update ${r.hm.source_player_id}: ${error.message}`);
      else hmDone++;
    }));
  }
  ok(`Updated ${hmDone} Hitter Master rows`);

  // ── Cascade to player_predictions.from_avg/obp/slg ─────────────────
  step("Cascading to player_predictions (returner-regular 2026)");
  const sourceIds = high.map((r) => r.hm.source_player_id).filter(Boolean);
  const sourceToPresto = new Map(high.map((r) => [r.hm.source_player_id, r.presto]));
  const idMap = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 100) {
    const chunk = sourceIds.slice(i, i + 100);
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const p of (data || [])) {
      if (p.source_player_id) idMap.set(p.source_player_id, p.id);
    }
  }
  const playerIds = Array.from(idMap.values());
  const predRows: Array<{ id: string; source_player_id: string }> = [];
  for (let i = 0; i < playerIds.length; i += 100) {
    const chunk = playerIds.slice(i, i + 100);
    const { data } = await sb.from("player_predictions").select("id, player_id").in("player_id", chunk).eq("model_type", "returner").eq("variant", "regular").eq("season", 2026);
    for (const r of (data || [])) {
      // Reverse lookup source_player_id from player_id
      for (const [sid, pid] of idMap) {
        if (pid === r.player_id) { predRows.push({ id: r.id, source_player_id: sid }); break; }
      }
    }
  }
  info(`Found ${predRows.length} matching prediction rows to refresh`);
  let predDone = 0;
  for (let i = 0; i < predRows.length; i += CONCURRENCY) {
    const chunk = predRows.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (r) => {
      const p = sourceToPresto.get(r.source_player_id);
      if (!p) return;
      const { error } = await sb.from("player_predictions").update({ from_avg: p.avg, from_obp: p.obp, from_slg: p.slg }).eq("id", r.id);
      if (!error) predDone++;
    }));
  }
  ok(`Updated ${predDone} player_predictions rows`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset} Medium + None CSVs left for manual review.`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
