/**
 * Consistency audit of Georgia 26-27 (active build roster + the program's target
 * board). Recomputes every invariant from the STORED wRC+/pRV+/WAR/depth and flags
 * genuine inconsistencies. Read-only.  npx tsx scripts/audit-georgia.ts
 *
 * Ground truth (verified against app bake sites):
 *  - Market bakes at the DESTINATION program (Georgia = SEC), not the player's
 *    origin conference. SEC tier = 1.5, $/WAR = 25000, floors at 0.
 *  - Hitter market = oWAR × 25000 × 1.5 × posMult(pos); posMult ∈ {1.3 C/SS/CF,
 *    1.1 2B/3B/IF/OF, 1.0 1B/DH/UT, 0.8 bench}. Pitcher market = pWAR × 25000 × 1.5.
 *  - player_snapshot stores depth roles → WAR is recomputable. transfer_snapshot
 *    does NOT store depth → only market-follows-WAR is checkable for targets.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computePitcherWar, paForHitterDepthRole, pitcherExpectedIp } from "../src/lib/depthRoles";
import { computeOWarFromWrcPlus } from "../src/lib/playerCalcs";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"));
const GA = "3b1cc0e2-4acd-4a27-a7bc-d345c347f18d", BUILD = "7429b448-17be-42a1-9434-86f54ab24e49";
const DPW = 25000, SEC = 1.5;
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const num = (v: any) => v == null ? null : Number(v);
const near = (a: any, b: any, tol: number) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;
const posMult = (p: string | null | undefined) => { const x = (p || "").trim().toUpperCase(); if (["C","CATCHER","SS","SHORTSTOP","CF","CENTERFIELD","CENTER FIELD"].includes(x)) return 1.3; if (["2B","3B","IF","INF","INFIELD","LF","RF","OF","OUTFIELD","COF"].includes(x)) return 1.1; if (["1B","DH","UT","UTL","UTIL","UTILITY"].includes(x)) return 1.0; if (["BENCH"].includes(x)) return 0.8; return null; };
const VALID_POS = [1.3, 1.1, 1.0, 0.8];

let real = 0;
const flag = (who: string, msg: string) => { real++; console.log(`  ❌ ${who}: ${msg}`); };

/** hitter market must follow oWAR at SEC × a VALID position multiplier */
function checkHitterMarket(who: string, owar: number | null, mkt: number | null, slotPos: string | null) {
  if (owar == null) return;
  const expBaseFloor0 = Math.max(0, owar * DPW * SEC); // pre-posMult, floored
  if (owar <= 0) { // market must floor at 0
    if (mkt != null && mkt > 500) flag(who, `hitter oWAR ${owar.toFixed(3)}≤0 → market must be 0, stored ${Math.round(mkt)}`);
    if (mkt != null && mkt < 0) flag(who, `hitter market NEGATIVE (${Math.round(mkt)}) — canonical fn floors at 0`);
    return;
  }
  if (mkt == null) { flag(who, `hitter oWAR ${owar.toFixed(3)} but market is null`); return; }
  if (mkt < 0) { flag(who, `hitter market NEGATIVE (${Math.round(mkt)}) — canonical fn floors at 0`); return; }
  const implied = mkt / (owar * DPW * SEC);
  // known slot position must match exactly; otherwise implied must land on a valid posMult
  if (slotPos && posMult(slotPos) != null) {
    if (!near(implied, posMult(slotPos)!, 0.02)) flag(who, `hitter market ${Math.round(mkt)} ⇒ implied mult ${implied.toFixed(3)} ≠ posMult(${slotPos})=${posMult(slotPos)} @ SEC×oWAR ${owar.toFixed(3)}`);
  } else if (!VALID_POS.some((m) => near(implied, m, 0.03))) {
    flag(who, `hitter market ${Math.round(mkt)} ⇒ implied tier×pos ${implied.toFixed(3)} not a valid SEC posMult {1.3,1.1,1.0,0.8} (owar ${owar.toFixed(3)})`);
  }
}
function checkPitcherMarket(who: string, pwar: number | null, mkt: number | null) {
  if (pwar == null) return;
  if (pwar <= 0) { if (mkt != null && mkt > 500) flag(who, `pitcher pWAR ${pwar.toFixed(3)}≤0 → market must be 0, stored ${Math.round(mkt)}`); return; }
  if (mkt == null) { flag(who, `pitcher pWAR ${pwar.toFixed(3)} but market is null`); return; }
  const exp = pwar * DPW * SEC;
  if (!near(mkt, exp, Math.max(750, exp * 0.02))) flag(who, `pitcher market ${Math.round(mkt)} ≠ pWAR×25000×1.5 = ${Math.round(exp)} (pWAR ${pwar.toFixed(3)})`);
}
const notesDepth = (pn: any) => (pn ? String(typeof pn === "string" ? pn : JSON.stringify(pn)).match(/"depthRole":"([^"]*)"/)?.[1] : null) ?? null;

(async () => {
  const nameMap = new Map<string, string>(), posMap = new Map<string, string>(), twpMap = new Map<string, boolean>();
  const getMeta = async (ids: string[]) => { for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position, is_twp").in("id", ids.slice(i, i + 200)); for (const p of (data || [])) { nameMap.set(p.id, `${p.first_name} ${p.last_name}`); posMap.set(p.id, p.position); twpMap.set(p.id, !!p.is_twp); } } };

  console.log("=== ROSTER — Georgia 26-27 team_build_players (player_snapshot) ===");
  const { data: bps } = await sb.from("team_build_players").select("player_id, position_slot, included_in_roster, player_snapshot, production_notes").eq("build_id", BUILD);
  await getMeta([...new Set((bps || []).map((r: any) => r.player_id))]);
  console.log(`roster rows: ${bps?.length}`);
  for (const r of (bps || [])) {
    const nm = nameMap.get(r.player_id) || r.player_id.slice(0, 8), who = `${nm} [${r.position_slot}]`, s = r.player_snapshot;
    if (!s) { flag(who, "no player_snapshot"); continue; }
    const rowIsPit = isPit(r.position_slot), isTwp = !!s.is_twp;
    if (rowIsPit) {
      const rv = num(s.p_rv_plus), pw = num(s.p_war), d = s.pitcher_depth_role;
      if (rv != null && pw != null) { const exp = computePitcherWar(Math.round(rv), pitcherExpectedIp(d, EQ), EQ); if (!near(pw, exp, 0.02)) flag(who, `pWAR ${pw.toFixed(3)} ≠ recompute(pRV+${Math.round(rv)}, ${d}/${pitcherExpectedIp(d, EQ)}IP)=${exp?.toFixed(3)}`); }
      else flag(who, `pitcher missing rv(${rv})/pwar(${pw})`);
      checkPitcherMarket(who, pw, isTwp ? num(s.twp_pitcher_market_value) : num(s.market_value));
    } else {
      const wrc = num(s.p_wrc_plus), ow = num(s.o_war), d = s.hitter_depth_role;
      if (wrc != null && ow != null) { const exp = computeOWarFromWrcPlus(wrc, paForHitterDepthRole(d)); if (!near(ow, exp, 0.01)) flag(who, `oWAR ${ow.toFixed(3)} ≠ recompute(wRC+${wrc}, ${d}/${paForHitterDepthRole(d)}PA)=${exp?.toFixed(3)}`); }
      else flag(who, `hitter missing wrc(${wrc})/owar(${ow})`);
      checkHitterMarket(who, num(s.o_war), isTwp ? num(s.twp_hitter_market_value) : num(s.market_value), r.position_slot);
    }
    if (isTwp) {
      if (rowIsPit && (num(s.o_war) != null || num(s.twp_hitter_market_value) != null)) flag(who, `TWP pitcher slot carries hitter data (o_war=${s.o_war}, twpH=${s.twp_hitter_market_value})`);
      if (!rowIsPit && (num(s.p_war) != null || num(s.twp_pitcher_market_value) != null)) flag(who, `TWP hitter slot carries pitcher data (p_war=${s.p_war}, twpP=${s.twp_pitcher_market_value})`);
      if (num(s.market_value) != null) flag(who, `TWP shared market_value should be null, got ${Math.round(num(s.market_value)!)}`);
    }
    const nd = notesDepth(r.production_notes), sd = rowIsPit ? s.pitcher_depth_role : s.hitter_depth_role;
    if (nd && sd && nd !== sd) flag(who, `production_notes depth "${nd}" ≠ snapshot depth "${sd}"`);
  }

  console.log("\n=== TARGET BOARD — Georgia target_board (transfer_snapshot) ===");
  const { data: tb } = await sb.from("target_board").select("player_id, transfer_snapshot").eq("customer_team_id", GA);
  await getMeta([...new Set((tb || []).map((r: any) => r.player_id))]);
  console.log(`target rows: ${tb?.length}  (no depth stored → market-follows-WAR check only)`);
  const rosterByPid = new Map<string, any[]>(); for (const r of (bps || [])) { if (!r.player_snapshot) continue; const a = rosterByPid.get(r.player_id) || []; a.push(r); rosterByPid.set(r.player_id, a); }
  for (const r of (tb || [])) {
    const nm = nameMap.get(r.player_id) || r.player_id.slice(0, 8), who = `${nm} (target)`, s = r.transfer_snapshot;
    if (!s) { flag(who, "no transfer_snapshot"); continue; }
    const isTwp = !!s.is_twp, pos = posMap.get(r.player_id) ?? null;
    const ow = num(s.owar), pw = num(s.p_war);
    if (ow != null) checkHitterMarket(who, ow, isTwp ? num(s.twp_hitter_market_value) : num(s.nil_valuation), pos);
    if (pw != null) checkPitcherMarket(who, pw, isTwp ? num(s.twp_pitcher_market_value) : num(s.nil_valuation));
    if (isTwp) {
      if (num(s.nil_valuation) != null) flag(who, `TWP shared nil_valuation should be null, got ${Math.round(num(s.nil_valuation)!)}`);
      if (ow != null && num(s.twp_hitter_market_value) == null) flag(who, `TWP has owar ${ow.toFixed(3)} but twp_hitter_market_value null`);
      if (pw != null && num(s.twp_pitcher_market_value) == null) flag(who, `TWP has pWAR ${pw.toFixed(3)} but twp_pitcher_market_value null`);
    }
    // rostered target 1:1: transfer side WAR == roster slot player_snapshot WAR
    const rr = rosterByPid.get(r.player_id);
    if (rr && rr.some((x) => x.included_in_roster)) {
      const h = rr.find((x) => !isPit(x.position_slot))?.player_snapshot, p = rr.find((x) => isPit(x.position_slot))?.player_snapshot;
      if (h && ow != null && !near(ow, num(h.o_war), 0.01)) flag(who, `rostered: transfer oWAR ${ow.toFixed(3)} ≠ roster player_snapshot o_war ${num(h.o_war)?.toFixed(3)}`);
      if (p && pw != null && !near(pw, num(p.p_war), 0.02)) flag(who, `rostered: transfer pWAR ${pw.toFixed(3)} ≠ roster player_snapshot p_war ${num(p.p_war)?.toFixed(3)}`);
    }
  }

  console.log(`\n===== ${real === 0 ? "✅ ALL CONSISTENT — 0 genuine inconsistencies" : `❌ ${real} genuine inconsistency(ies)`} =====`);
})();
