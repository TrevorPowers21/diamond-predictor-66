import { createClient } from "@supabase/supabase-js";
import { readPitchingWeights } from "../src/lib/pitchingEquations";
import { loadPitchingPowerEq } from "../src/lib/pitchingPowerRatings";
import { computePitcherProjection } from "../src/lib/pitcherProjection";

const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Justus Agosto's data
const sid = "1327017728";
const { data: p } = await (sb as any).from("players").select("id, team, team_id, conference, source_player_id").eq("source_player_id", sid).maybeSingle();
const { data: pred } = await (sb as any).from("player_predictions").select("*").eq("player_id", p.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
const { data: scoutingRow } = await (sb as any).from("Pitching Master").select("*").eq("source_player_id", sid).eq("Season", 2026).maybeSingle();

const eq = readPitchingWeights();
const powerEq = await loadPitchingPowerEq(2026);

console.log("=== Justus Agosto debug ===");
console.log(`pred.from_era=${pred.from_era}, from_fip=${pred.from_fip}, from_whip=${pred.from_whip}, from_k9=${pred.from_k9}, from_bb9=${pred.from_bb9}, from_hr9=${pred.from_hr9}`);
console.log(`scouting.Role=${scoutingRow.Role}, G=${scoutingRow.G}, GS=${scoutingRow.GS}, era_pr_plus=${scoutingRow.era_pr_plus}`);

console.log(`\neq.era_plus_ncaa_avg=${eq.era_plus_ncaa_avg}, era_plus_ncaa_sd=${eq.era_plus_ncaa_sd}, era_pr_sd=${eq.era_pr_sd}`);
console.log(`eq.fip_plus_ncaa_avg=${eq.fip_plus_ncaa_avg}, fip_pr_sd=${eq.fip_pr_sd}`);
console.log(`eq.whip_pr_sd=${eq.whip_pr_sd}, eq.k9_pr_sd=${eq.k9_pr_sd}, eq.bb9_pr_sd=${eq.bb9_pr_sd}, eq.hr9_pr_sd=${eq.hr9_pr_sd}`);

const result = computePitcherProjection({
  era: Number(pred.from_era),
  fip: Number(pred.from_fip),
  whip: Number(pred.from_whip),
  k9: Number(pred.from_k9),
  bb9: Number(pred.from_bb9),
  hr9: Number(pred.from_hr9),
  stuffPlus: scoutingRow.stuff_plus,
  miss_pct: scoutingRow.miss_pct,
  bb_pct: scoutingRow.bb_pct,
  hard_hit_pct: scoutingRow.hard_hit_pct,
  in_zone_whiff_pct: scoutingRow.in_zone_whiff_pct,
  chase_pct: scoutingRow.chase_pct,
  barrel_pct: scoutingRow.barrel_pct,
  line_pct: scoutingRow.line_pct,
  exit_vel: scoutingRow.exit_vel,
  ground_pct: scoutingRow.ground_pct,
  in_zone_pct: scoutingRow.in_zone_pct,
  vel_90th: scoutingRow["90th_vel"],
  h_pull_pct: scoutingRow.h_pull_pct,
  la_10_30_pct: scoutingRow.la_10_30_pct,
  role: scoutingRow.Role,
  g: scoutingRow.G,
  gs: scoutingRow.GS,
  team: p.team,
  teamId: p.team_id,
  conference: p.conference,
}, {
  eq,
  powerEq,
  parkMap: {} as any,
  teamMatch: { id: p.team_id, name: p.team, park_factor: null },
  classTransition: pred.class_transition ?? "SJ",
  devAggressiveness: pred.dev_aggressiveness ?? 0,
  storedPrPlus: {
    era: scoutingRow.era_pr_plus,
    fip: scoutingRow.fip_pr_plus,
    whip: scoutingRow.whip_pr_plus,
    k9: scoutingRow.k9_pr_plus,
    bb9: scoutingRow.bb9_pr_plus,
    hr9: scoutingRow.hr9_pr_plus,
  },
});

console.log(`\n=== Result ===`);
console.log(`projected_role: ${result.projected_role}`);
console.log(`p_era: ${result.p_era}`);
console.log(`p_fip: ${result.p_fip}`);
console.log(`p_whip: ${result.p_whip}`);
console.log(`p_k9: ${result.p_k9}`);
console.log(`p_bb9: ${result.p_bb9}`);
console.log(`p_hr9: ${result.p_hr9}`);
console.log(`p_rv_plus: ${result.p_rv_plus}`);
console.log(`p_war: ${result.p_war}`);
