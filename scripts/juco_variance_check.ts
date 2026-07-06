import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || "";
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Count precomputed JUCO transfer rows per team, split hitter (p_avg not null) vs pitcher (p_era not null)
const { data: teams } = await (sb as any).from("customer_teams").select("id, name, school_team_id").eq("active", true).not("name", "ilike", "%All-Americans%").order("name");

const allRows: any[] = [];
let from = 0;
while (true) {
  const { data } = await (sb as any)
    .from("player_predictions")
    .select("customer_team_id, p_avg, p_era, player_id, players!inner(division, source_team_id)")
    .eq("variant", "precomputed")
    .eq("model_type", "transfer")
    .eq("season", 2027)
    .eq("players.division", "NJCAA_D1")
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  allRows.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Total JUCO precomputed transfer rows: ${allRows.length}\n`);

const byTeam: Record<string, { hitters: number; pitchers: number; both: number; neither: number; ownRoster: number }> = {};
for (const t of teams ?? []) byTeam[t.id] = { hitters: 0, pitchers: 0, both: 0, neither: 0, ownRoster: 0 };

for (const r of allRows) {
  const t = byTeam[r.customer_team_id];
  if (!t) continue;
  const isHitter = r.p_avg != null;
  const isPitcher = r.p_era != null;
  if (isHitter && isPitcher) t.both++;
  else if (isHitter) t.hitters++;
  else if (isPitcher) t.pitchers++;
  else t.neither++;
}

console.log("Team                                  hitters  pitchers   both  neither  total  schoolTeamId");
console.log("─".repeat(120));
for (const t of teams ?? []) {
  const b = byTeam[t.id];
  const tot = b.hitters + b.pitchers + b.both + b.neither;
  console.log(`${t.name.padEnd(38)} ${String(b.hitters).padStart(7)}  ${String(b.pitchers).padStart(8)}  ${String(b.both).padStart(5)}  ${String(b.neither).padStart(7)}  ${String(tot).padStart(5)}  ${t.school_team_id}`);
}

// Now: are there JUCO source_team_id values that match any customer team's school_team_id?
const customerSchoolIds = new Set((teams ?? []).map((t: any) => String(t.school_team_id)).filter(Boolean));
const { data: jucoPlayers } = await (sb as any)
  .from("players")
  .select("id, source_team_id")
  .eq("division", "NJCAA_D1");
const jucoBySourceTeam: Record<string, number> = {};
for (const p of jucoPlayers ?? []) {
  if (customerSchoolIds.has(String(p.source_team_id))) {
    jucoBySourceTeam[p.source_team_id] = (jucoBySourceTeam[p.source_team_id] ?? 0) + 1;
  }
}
console.log("\nJUCO players whose source_team_id matches a customer team's school_team_id:");
console.log(JSON.stringify(jucoBySourceTeam, null, 2));
