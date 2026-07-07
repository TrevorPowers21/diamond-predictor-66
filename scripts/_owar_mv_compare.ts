/**
 * Compare CURRENT staging values vs WHAT-THEY-SHOULD-BE vs PROD values.
 * Uses the actual app math functions (not guesses).
 */
import { createClient } from "@supabase/supabase-js";
import {
  computeHitterOWar,
  computeHitterMarketValue,
  paForHitterDepthRole,
  defaultHitterDepthRoleFromActualPa,
} from "../src/lib/depthRoles";

const ST = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PR = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tests = [
  { name: "Michael Anderson (PSU, SR-IF)", sid: "1239164928" },
  { name: "Josh Overbeek (NEB, SR-IF)", sid: "1281745664" },
  { name: "Tyler Howard (UC Davis, JR-CF)", sid: "1135888384" },
  { name: "Kade Lewis (Wake Forest, JR-1B)", sid: "1135898880" },
];

for (const t of tests) {
  const { data: sPlayer } = await (ST as any).from("players").select("id, class_year, position, pa, conference, division").eq("source_player_id", t.sid).maybeSingle();
  const { data: pPlayer } = await (PR as any).from("players").select("id, class_year, position, pa, conference, division").eq("source_player_id", t.sid).maybeSingle();
  if (!sPlayer || !pPlayer) { console.log(`${t.name} MISSING (staging=${!!sPlayer} prod=${!!pPlayer})`); continue; }

  const { data: sPred } = await (ST as any).from("player_predictions").select("p_wrc_plus, o_war, market_value, hitter_depth_role").eq("player_id", sPlayer.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
  const { data: pPred } = await (PR as any).from("player_predictions").select("p_wrc_plus, o_war, market_value, hitter_depth_role").eq("player_id", pPlayer.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
  if (!sPred || !pPred) { console.log(`${t.name} MISSING pred`); continue; }

  // Compute "should be" using STAGING'S p_wrc_plus + STAGING's player meta
  const role = defaultHitterDepthRoleFromActualPa(sPlayer.pa);
  const tierPa = paForHitterDepthRole(role);
  const shouldOWarStaging = computeHitterOWar(sPred.p_wrc_plus, tierPa, role as any);
  const shouldMvStaging = computeHitterMarketValue(shouldOWarStaging, { conference: sPlayer.conference, position: sPlayer.position });

  // Compute "should be" using PROD'S values for sanity check (should match prod stored)
  const pRole = defaultHitterDepthRoleFromActualPa(pPlayer.pa);
  const pTierPa = paForHitterDepthRole(pRole);
  const shouldOWarProd = computeHitterOWar(pPred.p_wrc_plus, pTierPa, pRole as any);
  const shouldMvProd = computeHitterMarketValue(shouldOWarProd, { conference: pPlayer.conference, position: pPlayer.position });

  const fmt = (n: any) => n == null ? "NULL" : (typeof n === "number" ? n.toFixed(n < 100 ? 3 : 0) : String(n));
  console.log(`\n${t.name}  (raw_pa=${sPlayer.pa}, role=${role}, tier_pa=${tierPa}, conf=${sPlayer.conference}, pos=${sPlayer.position})`);
  console.log(`  Staging p_wrc+=${sPred.p_wrc_plus}  Prod p_wrc+=${pPred.p_wrc_plus}`);
  console.log(`  ┌─ o_war:`);
  console.log(`  │   staging currently:       ${fmt(sPred.o_war)}`);
  console.log(`  │   staging should-be:       ${fmt(shouldOWarStaging)}  ← what the fix produces on staging`);
  console.log(`  │   prod currently:          ${fmt(pPred.o_war)}`);
  console.log(`  │   prod should-be (sanity): ${fmt(shouldOWarProd)}  ← validates math matches prod's stored`);
  console.log(`  └─ MV:`);
  console.log(`      staging currently:       ${fmt(sPred.market_value)}`);
  console.log(`      staging should-be:       ${fmt(shouldMvStaging)}`);
  console.log(`      prod currently:          ${fmt(pPred.market_value)}`);
  console.log(`      prod should-be (sanity): ${fmt(shouldMvProd)}`);
}
