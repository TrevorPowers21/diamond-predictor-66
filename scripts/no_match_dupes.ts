import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Pull ALL no_match rows in pages of 1000
const all: any[] = [];
let from = 0;
while (true) {
  const { data, error } = await (sb as any)
    .from("portal_entries_unmatched")
    .select("id, first_name, last_name, current_school, position, ip, ab, ingested_at, va_roster_link")
    .eq("resolved", false)
    .eq("reason", "no_match")
    .order("ingested_at", { ascending: false })
    .range(from, from + 999);
  if (error) throw error;
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Total no_match rows: ${all.length}\n`);

// Group by (first+last) lowercased — same person, possibly multiple imports
const byName = new Map<string, any[]>();
for (const r of all) {
  const key = `${(r.first_name || "").trim().toLowerCase()}|${(r.last_name || "").trim().toLowerCase()}`;
  const arr = byName.get(key);
  if (arr) arr.push(r); else byName.set(key, [r]);
}

const dupes = [...byName.entries()].filter(([_, rows]) => rows.length > 1);
dupes.sort((a, b) => b[1].length - a[1].length);

const totalDupeRows = dupes.reduce((s, [_, rows]) => s + rows.length, 0);
const wasted = totalDupeRows - dupes.length; // we'd keep 1 of each, the rest are dupes

console.log(`Distinct names that have duplicates: ${dupes.length}`);
console.log(`Total rows across those duplicates:   ${totalDupeRows}`);
console.log(`Duplicate (removable) rows:           ${wasted}`);
console.log(`Unique no_match names overall:        ${byName.size}\n`);

console.log("Top 20 most-duplicated names:");
console.log("| Name | Count | School | Position | IP/AB | VA link match? |");
console.log("|---|---|---|---|---|---|");
for (const [key, rows] of dupes.slice(0, 20)) {
  const r = rows[0];
  const ipAb = r.ip != null ? `${r.ip} IP` : r.ab != null ? `${r.ab} AB` : "—";
  const allSameLink = new Set(rows.map((x) => x.va_roster_link)).size === 1;
  console.log(`| ${r.first_name} ${r.last_name} | ${rows.length}× | ${r.current_school ?? "—"} | ${r.position ?? "—"} | ${ipAb} | ${allSameLink ? "same" : "diff"} |`);
}
