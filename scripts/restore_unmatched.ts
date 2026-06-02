/**
 * Recover the 169 unmatched rows wiped by the sequential split imports.
 * Re-runs the importer matcher on the 3 cleared CSVs and inserts unmatched
 * rows into portal_entries_unmatched so they show up in Portal Review.
 *
 * The most recent CSV (transfers_Other_2026-06-01.csv) is already in the
 * table — only re-process the earlier 3.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url!, key!, { auth: { persistSession: false } });

// Same helpers as the importer
function nameKey(s: string) { return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, ""); }
function schoolKey(s: string | null | undefined) {
  if (!s) return "";
  return s.toLowerCase().replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\bthe\b/g, "").trim().replace(/[^a-z0-9]+/g, "");
}
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; } inQ = !inQ; continue; }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  }
  return d[m][n];
}
function parseDate(s: string | undefined | null) {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const [, mo, d, y] = m; const yr = y.length === 2 ? 2000 + Number(y) : Number(y); return `${yr}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
  return null;
}
function parseGpa(s: string | undefined) {
  if (!s) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

// Pull D1 players for matching
const players: any[] = [];
let from = 0;
while (true) {
  const { data } = await (supabase as any).from("players").select("id, first_name, last_name, team, position, class_year").eq("division", "D1").range(from, from + 1000);
  if (!data || data.length === 0) break;
  players.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Loaded ${players.length} D1 players`);

function matchPlayers(row: any): any[] {
  const fnk = nameKey(row.firstName);
  const lnk = nameKey(row.lastName);
  const sk = schoolKey(row.currentSchool);
  const pos = (row.position ?? "").toLowerCase();
  const yr = (row.year ?? "").toUpperCase().replace(/^R-?/, "");

  let candidates = players.filter(p => nameKey(p.first_name) === fnk && nameKey(p.last_name) === lnk && schoolKey(p.team) === sk);
  if (candidates.length === 1) return candidates;
  if (candidates.length === 0) {
    candidates = players.filter(p => nameKey(p.first_name) === fnk && nameKey(p.last_name) === lnk);
  }
  if (candidates.length === 0) {
    candidates = players.filter(p => {
      if (nameKey(p.last_name) !== lnk) return false;
      if (schoolKey(p.team) !== sk) return false;
      const pf = nameKey(p.first_name);
      if (pf === fnk) return true;
      const d = lev(pf, fnk);
      if (d <= 2) return true;
      const minLen = Math.min(pf.length, fnk.length);
      return minLen >= 3 && pf.slice(0, 3) === fnk.slice(0, 3);
    });
  }
  if (candidates.length <= 1) return candidates;
  if (pos) {
    const isPitcherCsv = /^(p|rhp|lhp)$/i.test(pos);
    const positioned = candidates.filter(p => {
      const pp = (p.position ?? "").toLowerCase();
      if (!pp) return false;
      const isPitcherDb = /^(p|rhp|lhp|sp|rp)$/i.test(pp);
      return isPitcherCsv === isPitcherDb;
    });
    if (positioned.length === 1) return positioned;
    if (positioned.length > 0) candidates = positioned;
  }
  if (yr) {
    const yearMatched = candidates.filter(p => (p.class_year ?? "").toUpperCase().replace(/^R-?/, "") === yr);
    if (yearMatched.length === 1) return yearMatched;
  }
  return candidates;
}

const importedDir = join(homedir(), "RSTR IQ Data", "imported", "2026-06-01");
const wipedFiles = readdirSync(importedDir).filter(f =>
  f.startsWith("transfers_") && f.endsWith(".csv") && !f.includes("Other")
);

let totalInserted = 0;
for (const fname of wipedFiles) {
  const text = readFileSync(join(importedDir, fname), "utf8");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  const lower = header.map(h => h.toLowerCase());
  const idxOf = (n: string) => lower.indexOf(n.toLowerCase());
  const cols = {
    firstName: idxOf("First Name"), lastName: idxOf("Last Name"), year: idxOf("Year"),
    division: idxOf("Division"), currentSchool: idxOf("Current School"),
    commitSchool: idxOf("Commit School"), commitDate: idxOf("Commit Date"),
    portalEntryDate: idxOf("Date"), athleticAid: idxOf("Athletic Aid"),
    position: idxOf("Position"), highSchool: idxOf("High School"),
    homeState: idxOf("State"), conference: idxOf("Conference"),
    contactEmail: idxOf("Email"), contactCell: idxOf("Cell"),
    gpa: idxOf("GPA"), rosterLink: idxOf("Roster Link"),
    gp: idxOf("GP"), ab: idxOf("AB"), ip: idxOf("IP"),
  };

  const inserts: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const division = (c[cols.division] ?? "").trim();
    if (division.toUpperCase() !== "D1") continue;
    const firstName = (c[cols.firstName] ?? "").trim();
    const lastName = (c[cols.lastName] ?? "").trim();
    if (!firstName && !lastName) continue;
    const row = {
      firstName, lastName,
      year: (c[cols.year] ?? "").trim(),
      currentSchool: (c[cols.currentSchool] ?? "").trim(),
      commitSchool: (c[cols.commitSchool] ?? "").trim() || null,
      commitDate: parseDate(c[cols.commitDate]),
      portalEntryDate: parseDate(c[cols.portalEntryDate]),
      athleticAid: (c[cols.athleticAid] ?? "").trim() || null,
      position: (c[cols.position] ?? "").trim() || null,
      highSchool: (c[cols.highSchool] ?? "").trim() || null,
      homeState: (c[cols.homeState] ?? "").trim() || null,
      conference: (c[cols.conference] ?? "").trim() || null,
      contactCell: (c[cols.contactCell] ?? "").trim() || null,
      contactEmail: (c[cols.contactEmail] ?? "").trim() || null,
      gpa: parseGpa(c[cols.gpa]),
      rosterLink: (c[cols.rosterLink] ?? "").trim() || null,
    };
    const blank = (s: string | undefined) => !s || s.trim() === "" || Number(s) === 0;
    const hasNoStats = blank(c[cols.gp]) && blank(c[cols.ab]) && blank(c[cols.ip]);
    const matches = matchPlayers(row);
    if (matches.length === 1) continue;
    const reason: "ambiguous" | "no_match" | "no_stats" = matches.length > 1 ? "ambiguous" : hasNoStats ? "no_stats" : "no_match";
    inserts.push({
      first_name: row.firstName, last_name: row.lastName, year_class: row.year || null,
      division: "D1", current_school: row.currentSchool || null, position: row.position,
      high_school: row.highSchool, home_state: row.homeState, conference: row.conference,
      portal_entry_date: row.portalEntryDate, commit_school: row.commitSchool, commit_date: row.commitDate,
      athletic_aid: row.athleticAid, contact_cell: row.contactCell, contact_email: row.contactEmail,
      gpa: row.gpa, va_roster_link: row.rosterLink, reason,
      candidate_player_ids: matches.length > 0 ? matches.map(m => m.id) : null,
    });
  }
  if (inserts.length > 0) {
    const { error } = await (supabase as any).from("portal_entries_unmatched").insert(inserts);
    if (error) { console.error(`${fname}: insert error:`, error.message); continue; }
    totalInserted += inserts.length;
    console.log(`${fname}: inserted ${inserts.length} unmatched`);
  } else {
    console.log(`${fname}: 0 unmatched (all matched by re-run)`);
  }
}

console.log(`\nTotal inserted: ${totalInserted}`);

const { count } = await (supabase as any).from("portal_entries_unmatched").select("id", { count: "exact", head: true }).eq("resolved", false);
console.log(`portal_entries_unmatched (resolved=false) now: ${count}`);
