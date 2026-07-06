import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const all: any[] = [];
let from = 0;
while (true) {
  const { data, error } = await (PROD as any)
    .from("player_predictions")
    .select("player_id, players!inner(class_year, division, team)")
    .eq("season", 2027).order("id").range(from, from + 999);
  if (error) { console.log("err", error.message); break; }
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const seen = new Set<string>();
const byDivision: Record<string, Set<string>> = {};
const sampleByDiv: Record<string, any[]> = {};
for (const r of all) {
  if (r.players?.class_year != null) continue;
  const pid = r.player_id;
  if (seen.has(pid)) continue;
  seen.add(pid);
  const div = r.players?.division ?? "(unknown)";
  if (!byDivision[div]) byDivision[div] = new Set();
  byDivision[div].add(pid);
  if (!sampleByDiv[div]) sampleByDiv[div] = [];
  if (sampleByDiv[div].length < 5) sampleByDiv[div].push({ team: r.players?.team });
}

console.log(`Total distinct prod 2027 players with NULL class_year: ${seen.size}\n`);
console.log(`By division:`);
for (const [div, set] of Object.entries(byDivision).sort((a,b)=>b[1].size - a[1].size)) {
  console.log(`  ${div.padEnd(15)} ${set.size}`);
}
console.log(`\nSample teams per division:`);
for (const [div, samples] of Object.entries(sampleByDiv)) {
  console.log(`  --- ${div} ---`);
  for (const s of samples) console.log(`    ${s.team}`);
}
