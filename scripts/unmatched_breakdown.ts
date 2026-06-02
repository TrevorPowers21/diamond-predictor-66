/** Break down unmatched portal rows by reason — current table + the 169 wiped. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url!, key!, { auth: { persistSession: false } });

// Current portal_entries_unmatched table — by reason
const { data: current } = await (supabase as any)
  .from("portal_entries_unmatched")
  .select("reason, first_name, last_name, current_school, position, division, resolved")
  .eq("resolved", false);

console.log(`## Current portal_entries_unmatched (resolved=false): ${current?.length ?? 0}\n`);
const byReason: Record<string, number> = {};
for (const r of current || []) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  console.log(`- ${reason}: **${count}**`);
}

// Recount from the 4 imported CSVs to see total unmatched-by-reason across all 4
console.log(`\n## Cumulative unmatched across all 4 split CSVs:\n`);

const imported = join(homedir(), "RSTR IQ Data", "imported", "2026-06-01");
const csvs = readdirSync(imported)
  .filter((f) => f.startsWith("transfers_") && f.includes("2026-06-01") && f.endsWith(".csv"));

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// Pull D1 player ids + name keys for matching
const all: any[] = [];
let from = 0;
while (true) {
  const { data } = await (supabase as any).from("players").select("first_name, last_name, team").eq("division", "D1").range(from, from + 1000);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const playerKeySet = new Set(all.map((p) => `${(p.first_name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}_${(p.last_name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}_${(p.team || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`));
const nameKeySet = new Set(all.map((p) => `${(p.first_name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}_${(p.last_name || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`));

let totalRows = 0;
let totalUnmatched = 0;
let totalNoStats = 0;
let totalHasStats = 0;

for (const csv of csvs) {
  const path = join(imported, csv);
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n.toLowerCase());
  const cols = {
    first: idx("First Name"),
    last: idx("Last Name"),
    div: idx("Division"),
    school: idx("Current School"),
    gp: idx("GP"),
    ab: idx("AB"),
    ip: idx("IP"),
  };

  let unmatched = 0, noStats = 0, hasStats = 0, rows = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const div = (c[cols.div] ?? "").trim();
    if (div.toUpperCase() !== "D1") continue;
    rows++;
    const first = (c[cols.first] ?? "").trim();
    const last = (c[cols.last] ?? "").trim();
    const school = (c[cols.school] ?? "").trim();
    const fn = first.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ln = last.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const sk = school.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!nameKeySet.has(`${fn}_${ln}`) && !playerKeySet.has(`${fn}_${ln}_${sk}`)) {
      unmatched++;
      const gp = (c[cols.gp] ?? "").trim();
      const ab = (c[cols.ab] ?? "").trim();
      const ip = (c[cols.ip] ?? "").trim();
      const blank = (s: string) => !s || s === "0" || s === "0.0";
      if (blank(gp) && blank(ab) && blank(ip)) noStats++;
      else hasStats++;
    }
  }
  console.log(`- ${csv}: ${rows} D1 / ${unmatched} unmatched (${noStats} no-stats / ${hasStats} with-stats)`);
  totalRows += rows;
  totalUnmatched += unmatched;
  totalNoStats += noStats;
  totalHasStats += hasStats;
}

console.log(`\n## Cumulative across all 4 CSVs`);
console.log(`- D1 rows: **${totalRows}**`);
console.log(`- Unmatched: **${totalUnmatched}**`);
console.log(`  - no GP/AB/IP (walk-on / non-rostered): **${totalNoStats}**`);
console.log(`  - had stats but no DB match: **${totalHasStats}**`);
