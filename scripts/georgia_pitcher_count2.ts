import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const GEORGIA = "9aef3923-0f11-4813-8036-5766b0db64b6";

async function loadAll<T>(builder: () => any): Promise<T[]> {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// Properly paginated: Georgia precomputed transfer rows for JUCO players
const allRows = await loadAll(() =>
  (sb as any)
    .from("player_predictions")
    .select("player_id, p_avg, p_era, players!inner(division)")
    .eq("customer_team_id", GEORGIA)
    .eq("variant", "precomputed")
    .eq("model_type", "transfer")
    .eq("season", 2027)
    .eq("players.division", "NJCAA_D1")
);
console.log(`Georgia JUCO precomputed transfer rows: ${allRows.length}`);
let hitters = 0, pitchers = 0;
for (const r of allRows as any[]) {
  if (r.p_avg != null) hitters++;
  if (r.p_era != null) pitchers++;
}
console.log(`Hitter rows: ${hitters}`);
console.log(`Pitcher rows: ${pitchers}`);

// All JUCO players (full pagination)
const allJucoPlayers = await loadAll(() =>
  (sb as any).from("players").select("id, position, ip, pa, is_twp, source_team_id").eq("division", "NJCAA_D1")
);
console.log(`\nTotal JUCO players: ${allJucoPlayers.length}`);

const { data: ct } = await (sb as any).from("customer_teams").select("school_team_id").eq("id", GEORGIA).single();
const georgiaSchoolId = ct?.school_team_id;
const isPitcherPos = (p: string | null) => /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(p || ""));

let pitcherEligible = 0;
let ownTeam = 0, ipLow = 0, ok = 0;
for (const p of allJucoPlayers as any[]) {
  if (!isPitcherPos(p.position) && !p.is_twp) continue;
  pitcherEligible++;
  if (georgiaSchoolId && String(p.source_team_id) === String(georgiaSchoolId)) { ownTeam++; continue; }
  if ((Number(p.ip) || 0) < 20) { ipLow++; continue; }
  ok++;
}
console.log(`Pitcher-eligible JUCO: ${pitcherEligible}`);
console.log(`  Filtered out — own team: ${ownTeam}`);
console.log(`  Filtered out — IP<20: ${ipLow}`);
console.log(`  Passes filter (should be precomputed): ${ok}`);
