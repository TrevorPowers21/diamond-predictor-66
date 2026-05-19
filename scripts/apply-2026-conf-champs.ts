/**
 * Apply 2026 conference champion flags to team_war_snapshots.
 *
 * Reads ~/RSTR IQ Data/staging/2026 Regular Season Champions.csv,
 * splits multi-champion conferences (on " & " and ", "), then fuzzy-
 * matches each champion name against team_war_snapshots.team_name for
 * season=2026 and sets is_conference_champ=true.
 *
 * Reports unmatched names so the user can either fix the CSV or
 * manually flag the row.
 *
 * Usage:
 *   npx tsx scripts/apply-2026-conf-champs.ts          # staging
 *   npx tsx scripts/apply-2026-conf-champs.ts --prod   # prod
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };

const STAGING_URL = "https://slrxowawbijbjrkozqlj.supabase.co";
const PROD_URL = "https://trbvxuoliwrfowibatkm.supabase.co";

const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.local";
const url = isProd ? PROD_URL : STAGING_URL;

const key = readFileSync(envFile, "utf-8")
  .split("\n").find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))?.split("=", 2)[1] ?? "";
if (!key) {
  console.error(`${C.red}Missing SUPABASE_SERVICE_ROLE_KEY in ${envFile}${C.reset}`);
  process.exit(1);
}

const sb = createClient(url, key);
const csvPath = join(process.env.HOME ?? "", "RSTR IQ Data", "staging", "2026 Regular Season Champions.csv");

function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Levenshtein distance for last-resort fuzzy match
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[m][n];
}

interface Champion {
  conference: string;
  abbrev: string;
  name: string;
}

function parseCsv(): Champion[] {
  const text = readFileSync(csvPath, "utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: Champion[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parsing — handle quoted fields with commas
    const line = lines[i];
    const fields: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { fields.push(cur); cur = ""; continue; }
      cur += ch;
    }
    fields.push(cur);
    if (fields.length < 4) continue;
    const [conferenceName, abbrev, , championsField] = fields.map((f) => f.trim());
    // Split on " & " and ", " — multi-champion conferences
    const champs = championsField
      .split(/\s*&\s*|\s*,\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const c of champs) {
      out.push({ conference: conferenceName, abbrev, name: c });
    }
  }
  return out;
}

async function main() {
  console.log(`${C.cyan}Target: ${isProd ? "PROD" : "STAGING"} (${url})${C.reset}\n`);

  const champions = parseCsv();
  console.log(`Parsed ${champions.length} champion entries from CSV (incl. split champs)\n`);

  // Fetch all 2026 team rows
  const { data: rows, error } = await sb
    .from("team_war_snapshots")
    .select("source_team_id, team_name, conference")
    .eq("season", 2026);
  if (error) { console.error(`${C.red}Fetch failed: ${error.message}${C.reset}`); process.exit(1); }
  if (!rows || rows.length === 0) {
    console.error(`${C.red}No 2026 rows in team_war_snapshots — run seed_team_war_snapshots_2026.sql first${C.reset}`);
    process.exit(1);
  }
  console.log(`${rows.length} team_war_snapshots rows for 2026\n`);

  // Reset all 2026 conf-champ flags
  console.log("Resetting all 2026 conference flags...");
  const { error: resetErr } = await sb
    .from("team_war_snapshots")
    .update({ is_conference_champ: false })
    .eq("season", 2026);
  if (resetErr) { console.error(`${C.red}Reset failed: ${resetErr.message}${C.reset}`); process.exit(1); }

  // Fuzzy match: exact normalized first, then closest Levenshtein
  const normToRows = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = norm(r.team_name ?? "");
    if (!normToRows.has(k)) normToRows.set(k, []);
    normToRows.get(k)!.push(r);
  }

  const flagged: string[] = [];
  const unmatched: Champion[] = [];

  for (const c of champions) {
    const target = norm(c.name);
    let match: typeof rows[0] | undefined;

    // 1. Exact normalized match
    const exact = normToRows.get(target);
    if (exact && exact.length === 1) match = exact[0];

    // 2. Substring containment (champion name appears IN team_name or vice versa)
    if (!match) {
      const candidates = rows.filter((r) => {
        const rn = norm(r.team_name ?? "");
        return rn.includes(target) || target.includes(rn);
      });
      if (candidates.length === 1) match = candidates[0];
    }

    // 3. Levenshtein on champions within same conference (if conference name is recognizable)
    if (!match) {
      const scored = rows.map((r) => ({ r, d: lev(target, norm(r.team_name ?? "")) }));
      scored.sort((a, b) => a.d - b.d);
      // Accept best if distance < 5 AND unique by 2-point margin
      if (scored.length > 0 && scored[0].d <= 4 && (scored.length < 2 || scored[1].d >= scored[0].d + 2)) {
        match = scored[0].r;
      }
    }

    if (!match) { unmatched.push(c); continue; }

    const { error: updErr } = await sb
      .from("team_war_snapshots")
      .update({ is_conference_champ: true })
      .eq("season", 2026)
      .eq("source_team_id", match.source_team_id);
    if (updErr) {
      console.log(`${C.red}  ✗ ${c.name} → ${match.team_name}: ${updErr.message}${C.reset}`);
    } else {
      flagged.push(`${c.abbrev}: ${match.team_name}`);
      console.log(`${C.green}  ✓ ${c.name} → ${match.team_name} (${c.abbrev})${C.reset}`);
    }
  }

  console.log(`\n${C.cyan}=== Summary ===${C.reset}`);
  console.log(`${C.green}Flagged: ${flagged.length}${C.reset}`);
  if (unmatched.length > 0) {
    console.log(`${C.yellow}Unmatched: ${unmatched.length}${C.reset}`);
    for (const u of unmatched) console.log(`  - ${u.abbrev}: "${u.name}"`);
  }

  // Final count check
  const { count } = await (sb as any)
    .from("team_war_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("season", 2026)
    .eq("is_conference_champ", true);
  console.log(`\nis_conference_champ=true rows for 2026: ${count}`);
}

main().catch((e) => { console.error(C.red + e + C.reset); process.exit(1); });
