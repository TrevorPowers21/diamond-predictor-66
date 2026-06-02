/** Backfill GP/AB/IP from the source CSVs into portal_entries_unmatched. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

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
function key(first: string, last: string, school: string) {
  return `${first.toLowerCase().trim()}|${last.toLowerCase().trim()}|${school.toLowerCase().trim()}`;
}
const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};

// Build a key → {gp, ab, ip} map from the 4 imported CSVs
const importedDir = join(homedir(), "RSTR IQ Data", "imported", "2026-06-01");
const csvs = readdirSync(importedDir).filter((f) => f.startsWith("transfers_") && f.endsWith(".csv"));
const sampleByKey = new Map<string, { gp: number | null; ab: number | null; ip: number | null }>();
for (const csv of csvs) {
  const text = readFileSync(join(importedDir, csv), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (n: string) => header.indexOf(n.toLowerCase());
  const ci = {
    first: col("First Name"), last: col("Last Name"), school: col("Current School"),
    gp: col("GP"), ab: col("AB"), ip: col("IP"),
  };
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const k = key(c[ci.first] || "", c[ci.last] || "", c[ci.school] || "");
    sampleByKey.set(k, { gp: num(c[ci.gp]), ab: num(c[ci.ab]), ip: num(c[ci.ip]) });
  }
}
console.log(`Loaded sample data for ${sampleByKey.size} unique CSV rows`);

// Pull all unresolved unmatched
const all: any[] = [];
let from = 0;
while (true) {
  const { data } = await (sb as any)
    .from("portal_entries_unmatched")
    .select("id, first_name, last_name, current_school")
    .eq("resolved", false)
    .range(from, from + 1000);
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`${all.length} unresolved rows to backfill`);

let updated = 0, notFound = 0;
for (const r of all) {
  const k = key(r.first_name || "", r.last_name || "", r.current_school || "");
  const s = sampleByKey.get(k);
  if (!s) { notFound++; continue; }
  const ip = s.ip != null && Number.isFinite(s.ip) ? s.ip : null;
  const { error } = await (sb as any)
    .from("portal_entries_unmatched")
    .update({ gp: s.gp, ab: s.ab, ip })
    .eq("id", r.id);
  if (error) { console.error(r.id, error.message); continue; }
  updated++;
}
console.log(`Updated: ${updated}, not found in CSVs: ${notFound}`);
