/**
 * Targeted prod-residual repair for the two remaining REAL verify-all flags after
 * the systemic wRC+ + market consistency passes:
 *
 *   1. Kade Newman (BYU active build) — a pure UTL hitter mis-slotted in "RP4", so
 *      his row's neutral_snapshot was written as a (null) PITCHER neutral. Overwrite
 *      it with his real HITTER neutral so heal can recompute his line (devAgg 0.5 →
 *      matches the already-healed board). Slot left as-is; side is now data-shape driven.
 *
 *   2. Kenny Ishikawa (Georgia, TWP) — modeled two-way (Trevor's call). Active build
 *      has only his hitter row; his board's pitcher (SP) row carries a copy of the
 *      HITTER data. Add a real pitcher row to the active build + rewrite the board SP
 *      row with his canonical pitcher projection (swing_starter, no toggle).
 *
 *   npx tsx scripts/fix-prod-residuals.ts [--apply] [--yes]   (default: dry-run)
 *   Prod apply requires --yes (or RSTR_AUTOMATION_TOKEN).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { projectEffectiveWar } from "../src/lib/projectEffective";
import { computePitcherMarketValue, pitcherExpectedIp } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";

const ENV = ".env.production.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL"), rd("SUPABASE_SERVICE_ROLE_KEY"));
const APPLY = process.argv.includes("--apply");
if (APPLY && !process.env.RSTR_AUTOMATION_TOKEN && !process.argv.includes("--yes")) { console.error("prod apply needs --yes"); process.exit(1); }
const j = (o: any) => JSON.stringify(o);
const GA_BUILD = "2dd85293-9d03-4d51-bb55-66a32153d035";
const BYU_BUILD = "9bb9cc93-5073-465b-9287-51480c8f8837";

(async () => {
  const pid = async (fn: string, ln: string) => (await sb.from("players").select("id").eq("first_name", fn).eq("last_name", ln)).data?.[0]?.id as string;

  // ---------- 1. NEWMAN neutral repair ----------
  const nwId = await pid("Kade", "Newman");
  const { data: nwRows } = await sb.from("team_build_players").select("id, neutral_snapshot, player_snapshot").eq("player_id", nwId).eq("build_id", BYU_BUILD);
  const nw = nwRows?.[0];
  // his true hitter neutral (dev_agg=0) from the precomputed prediction for BYU
  const { data: nwPred } = await sb.from("player_predictions").select("p_avg,p_obp,p_slg,p_iso,p_wrc_plus,o_war,hitter_depth_role,class_transition").eq("player_id", nwId).eq("season", 2027).eq("customer_team_id", "deeb0be0-83c1-4a84-ba47-4a719f967d48").eq("variant", "precomputed").limit(1);
  const p = nwPred?.[0];
  const nwNeu = p ? {
    p_avg: p.p_avg, p_obp: p.p_obp, p_slg: p.p_slg, p_iso: p.p_iso, p_wrc_plus: p.p_wrc_plus, o_war: p.o_war,
    hitter_depth_role: p.hitter_depth_role ?? "utility", class_transition: p.class_transition ?? "SJ", dev_aggressiveness: 0,
    market_value: null,
  } : null;
  console.log("== NEWMAN neutral repair ==");
  console.log("  old neu (pitcher, null):", j(nw?.neutral_snapshot));
  console.log("  new neu (hitter)       :", j(nwNeu));
  console.log("  (heal --all --market --apply must be RE-RUN after this to recompute his snapshot to devAgg 0.5)");

  // ---------- 2. KENNY two-way ----------
  const keId = await pid("Kenny", "Ishikawa");
  const { data: keRows } = await sb.from("team_build_players").select("*").eq("player_id", keId);
  const keActive = keRows?.find((r: any) => r.build_id === GA_BUILD);         // hitter row (RF)
  const keTemplate = keRows?.find((r: any) => r.position_slot === "SP" || r.position_slot === "RP"); // row-shape template
  // Pitcher projection: DEPTH ROLE is authoritative and projected IP reads FROM it
  // (pitcherExpectedIp), NOT the stored projected_ip field — some stored projected_ip
  // are messed up (his returner-global row says 85; the depth role swing_starter = 30 IP,
  // and every clean customer row uses 30). p_war is computed OFF the depth IP.
  // Take rv+ (talent) from the returner global row, but IP/pWAR from the depth role.
  const { data: gRows } = await sb.from("player_predictions").select("p_era,p_fip,p_whip,p_k9,p_bb9,p_hr9,p_rv_plus,pitcher_role,pitcher_depth_role,class_transition").eq("player_id", keId).eq("season", 2027).eq("model_type", "returner").eq("variant", "regular").is("customer_team_id", null).limit(1);
  const g = gRows?.[0] as any;
  const depth = g?.pitcher_depth_role ?? "swing_starter";
  const ip = pitcherExpectedIp(depth as any, EQ);
  const pNeu = {
    p_era: g?.p_era, p_fip: g?.p_fip, p_whip: g?.p_whip, p_k9: g?.p_k9, p_bb9: g?.p_bb9, p_hr9: g?.p_hr9,
    p_rv_plus: g?.p_rv_plus, pitcher_role: g?.pitcher_role ?? "SP", pitcher_depth_role: depth,
    projected_ip: ip, class_transition: g?.class_transition ?? "SJ", dev_aggressiveness: 0,
  };
  // p_war OFF the depth IP (projectEffective uses pitcherExpectedIp(depth) when depth known)
  const proj = projectEffectiveWar(pNeu, { depthRole: depth, devAggressiveness: 0, classTransition: pNeu.class_transition }, EQ, "SP");
  const pwar = proj.pwar;
  const mkt = pwar != null ? computePitcherMarketValue(pwar, { conference: "SEC", role: "SP" as any, team: "Georgia" }, EQ) : null;
  const rts = proj.rates;
  const pitSnap = {
    o_war: null, p_avg: null, p_obp: null, p_slg: null, p_wrc_plus: null,
    p_war: pwar, p_rv_plus: rts?.p_rv_plus ?? (g?.p_rv_plus != null ? Math.round(Number(g.p_rv_plus)) : null),
    p_era: rts?.p_era ?? g?.p_era, p_fip: rts?.p_fip ?? g?.p_fip, p_whip: rts?.p_whip ?? g?.p_whip,
    p_k9: rts?.p_k9 ?? g?.p_k9, p_bb9: rts?.p_bb9 ?? g?.p_bb9, p_hr9: rts?.p_hr9 ?? g?.p_hr9,
    is_twp: true, projected_ip: ip,
    hitter_depth_role: null, pitcher_depth_role: depth,
    market_value: null, twp_hitter_market_value: null, twp_pitcher_market_value: mkt,
  };
  const pitNotes = keTemplate?.production_notes; // returner, swing_starter, devAgg 0
  console.log("\n== KENNY two-way ==");
  console.log(`  active hitter row: ${keActive?.id} slot=${keActive?.position_slot} (unchanged)`);
  console.log(`  NEW active pitcher row: build=${GA_BUILD.slice(0,8)} slot=SP  pWAR=${pwar?.toFixed(3)} rv+=${pitSnap.p_rv_plus} twpP$=${mkt == null ? "—" : Math.round(mkt)}`);
  console.log("    snap:", j(pitSnap));
  // board SP row to rewrite
  const { data: keBoard } = await sb.from("target_board").select("id, position_slot, transfer_snapshot").eq("player_id", keId).eq("customer_team_id", "9aef3923-05ec-4f0c-8f8f-4d2f5b3f9c3f".slice(0,0) || undefined as any);
  const { data: keBoardAll } = await sb.from("target_board").select("id, customer_team_id, position_slot, transfer_snapshot").eq("player_id", keId);
  const boardSP = keBoardAll?.find((r: any) => (r.position_slot === "SP" || r.position_slot === "RP"));
  const boardPitSnap = { ...pitSnap, owar: null, nil_valuation: null };
  console.log(`  board SP row: ${boardSP?.id} — rewrite transfer_snapshot to pitcher data`);
  console.log("    new board snap:", j(boardPitSnap));

  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply --yes.)"); return; }

  // apply Newman
  if (nwNeu && nw) { const { error } = await sb.from("team_build_players").update({ neutral_snapshot: nwNeu }).eq("id", nw.id); console.log(error ? `NEWMAN err ${error.message}` : "✅ NEWMAN neutral repaired"); }
  // apply Kenny active pitcher row (insert) — clone template row shape, swap build/slot/snap
  if (keTemplate && pwar != null) {
    const ins: any = { ...keTemplate };
    delete ins.id; delete ins.created_at; delete ins.updated_at;
    ins.build_id = GA_BUILD; ins.position_slot = "SP"; ins.included_in_roster = true;
    ins.player_snapshot = pitSnap; ins.production_notes = pitNotes;
    const { error } = await sb.from("team_build_players").insert(ins);
    console.log(error ? `KENNY build-insert err ${error.message}` : "✅ KENNY active pitcher row inserted");
  }
  // apply Kenny board SP rewrite
  if (boardSP && pwar != null) { const { error } = await sb.from("target_board").update({ transfer_snapshot: boardPitSnap }).eq("id", boardSP.id); console.log(error ? `KENNY board err ${error.message}` : "✅ KENNY board pitcher row rewritten"); }
})();
