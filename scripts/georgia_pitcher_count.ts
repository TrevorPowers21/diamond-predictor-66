import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const GEORGIA = "9aef3923-0f11-4813-8036-5766b0db64b6";

// Count Georgia precomputed transfer rows linked to JUCO players, broken down by what columns are populated
const { data: all } = await (sb as any)
  .from("player_predictions")
  .select("player_id, p_avg, p_era, projected_ip, pitcher_role, players!inner(division)")
  .eq("customer_team_id", GEORGIA)
  .eq("variant", "precomputed")
  .eq("model_type", "transfer")
  .eq("season", 2027)
  .eq("players.division", "NJCAA_D1")
  .range(0, 9999);

console.log(`Total rows: ${all?.length ?? 0}`);
let hitterOnly = 0, pitcherOnly = 0, both = 0, neither = 0;
for (const r of all ?? []) {
  const h = r.p_avg != null;
  const p = r.p_era != null;
  if (h && p) both++;
  else if (h) hitterOnly++;
  else if (p) pitcherOnly++;
  else neither++;
}
console.log(`Hitter-only (p_avg populated, p_era null): ${hitterOnly}`);
console.log(`Pitcher-only (p_era populated, p_avg null): ${pitcherOnly}`);
console.log(`Both populated: ${both}`);
console.log(`Neither populated: ${neither}`);

// Compare: how many JUCO pitchers PASS the filter in the script?
// Filter: not is_twp pitcher OR pitcher with is_twp; division=NJCAA_D1; ip>=20; source_team_id != Georgia's school_team_id
const { data: ct } = await (sb as any).from("customer_teams").select("school_team_id").eq("id", GEORGIA).single();
const georgiaSchoolId = ct?.school_team_id;
console.log(`\nGeorgia school_team_id: ${georgiaSchoolId}`);

const { data: jucoPitchers } = await (sb as any)
  .from("players")
  .select("id, source_player_id, source_team_id, position, ip, is_twp, division")
  .eq("division", "NJCAA_D1")
  .range(0, 9999);
const isPitcherPos = (p: string | null) => /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(p || ""));
let totalJucoPitchers = 0;
let filterOut: Record<string, number> = { ipLow: 0, ownTeam: 0, notPitcher: 0, ok: 0 };
for (const p of jucoPitchers ?? []) {
  if (isPitcherPos(p.position) || p.is_twp) {
    totalJucoPitchers++;
    if (georgiaSchoolId && String(p.source_team_id) === String(georgiaSchoolId)) {
      filterOut.ownTeam++;
    } else if ((Number(p.ip) || 0) < 20) {
      filterOut.ipLow++;
    } else {
      filterOut.ok++;
    }
  } else {
    filterOut.notPitcher++;
  }
}
console.log(`\nJUCO players in players table: ${jucoPitchers?.length ?? 0}`);
console.log(`Pitcher-eligible JUCO (position match OR is_twp): ${totalJucoPitchers}`);
console.log(`Filter breakdown: ${JSON.stringify(filterOut)}`);
