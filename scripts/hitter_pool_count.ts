import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const all: any[] = [];
let from = 0;
const pageSize = 1000;
while (true) {
  const { data, error, count } = await (sb as any)
    .from("Hitter Master")
    .select("source_player_id, playerFullName, Team, Season, ab", { count: from === 0 ? "exact" : undefined })
    .eq("Season", 2026)
    .range(from, from + pageSize - 1);
  if (error) { console.log("err:", error.message); break; }
  if (from === 0) console.log(`Total matching rows (count): ${count}`);
  all.push(...(data || []));
  console.log(`  page from=${from} → got ${data?.length || 0}`);
  if (!data || data.length < pageSize) break;
  from += pageSize;
}
console.log(`\nTotal loaded: ${all.length}`);

const idCounts = new Map<string, number>();
for (const r of all) {
  const id = r.source_player_id || `${r.playerFullName}|${r.Team}`;
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
}
const dupes = [...idCounts.entries()].filter(([_, c]) => c > 1);
console.log(`Dupes: ${dupes.length}`);
console.log(`Unique rows: ${idCounts.size}`);
