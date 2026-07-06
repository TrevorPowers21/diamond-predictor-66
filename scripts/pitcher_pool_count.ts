import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Reproduce the exact usePitchingSeedData query
const all: any[] = [];
let from = 0;
const pageSize = 1000;
while (true) {
  const { data, error, count } = await (sb as any)
    .from("Pitching Master")
    .select("source_player_id, playerFullName, Team, Season, IP, Role", { count: from === 0 ? "exact" : undefined })
    .eq("Season", 2026)
    .gte("IP", 10)
    .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)")
    .range(from, from + pageSize - 1);
  if (error) { console.log("err:", error.message); break; }
  if (from === 0) console.log(`Total matching rows (count): ${count}`);
  all.push(...(data || []));
  console.log(`  page from=${from} → got ${data?.length || 0}`);
  if (!data || data.length < pageSize) break;
  from += pageSize;
}
console.log(`\nTotal loaded: ${all.length}`);

const flora = all.find((r) => (r.playerFullName || "").includes("Flora"));
const klecker = all.find((r) => (r.playerFullName || "").includes("Klecker"));
console.log("Flora in result?", flora ? "YES" : "NO", flora);
console.log("Klecker in result?", klecker ? "YES" : "NO", klecker);

// Check for duplicates by source_player_id
const idCounts = new Map<string, number>();
for (const r of all) {
  const id = r.source_player_id || `${r.playerFullName}|${r.Team}`;
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
}
const dupes = [...idCounts.entries()].filter(([_, c]) => c > 1);
console.log(`\nDupes by source_player_id: ${dupes.length}`);
if (dupes.length > 0) console.log(dupes.slice(0, 10));
