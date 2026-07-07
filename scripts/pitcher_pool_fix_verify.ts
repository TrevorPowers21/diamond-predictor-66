import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// EXACT new query — concurrent fetch + .order("source_player_id")
const all: any[] = [];
const pageSize = 1000;
const CONCURRENT = 5;
let from = 0;

const fetchPage = (offset: number) =>
  (sb as any)
    .from("Pitching Master")
    .select("source_player_id, playerFullName, Team, Season, IP, Role")
    .eq("Season", 2026)
    .gte("IP", 10)
    .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)")
    .order("source_player_id", { ascending: true })
    .range(offset, offset + pageSize - 1);

const t0 = performance.now();
while (true) {
  const batch = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, i) => fetchPage(from + i * pageSize))
  );
  let anyFull = false;
  for (const { data, error } of batch) {
    if (error) { console.log("err:", error.message); break; }
    if (data && data.length > 0) all.push(...data);
    if (data && data.length === pageSize) anyFull = true;
  }
  from += CONCURRENT * pageSize;
  if (!anyFull) break;
}
const ms = Math.round(performance.now() - t0);

console.log(`Loaded ${all.length} rows in ${ms}ms`);

// Dupe check
const idCounts = new Map<string, number>();
for (const r of all) {
  const id = r.source_player_id || `${r.playerFullName}|${r.Team}`;
  idCounts.set(id, (idCounts.get(id) || 0) + 1);
}
const dupes = [...idCounts.entries()].filter(([_, c]) => c > 1);
console.log(`Unique rows: ${idCounts.size}`);
console.log(`Dupes: ${dupes.length}`);

// Target players
const flora = all.find((r) => (r.playerFullName || "").includes("Flora"));
const klecker = all.find((r) => (r.playerFullName || "").includes("Klecker"));
const neiswonger = all.find((r) => (r.playerFullName || "").includes("Neiswonger"));
console.log(`\nFlora present?     ${flora ? "✓" : "✗"}`);
console.log(`Klecker present?   ${klecker ? "✓" : "✗"}`);
console.log(`Neiswonger present? ${neiswonger ? "✓" : "✗"}`);

// Null source_player_id check (would sort last; still need to be sure they come through)
const nullIds = all.filter((r) => !r.source_player_id);
console.log(`\nRows with null source_player_id: ${nullIds.length}`);
if (nullIds.length > 0) console.log("  sample:", nullIds.slice(0, 3));
