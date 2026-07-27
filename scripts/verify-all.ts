/**
 * Full DB verification across ALL programs (read-only). Recomputes every invariant
 * from stored values and reports mismatches. Trevor can't open the browser, so this
 * is the proof of correctness.  npx tsx scripts/verify-all.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computePitcherWar, paForHitterDepthRole, pitcherExpectedIp, computeHitterMarketValue, computePitcherMarketValue, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { computeOWarFromWrcPlus } from "../src/lib/playerCalcs";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
import { resolveActiveBuildId } from "../src/lib/activeBuild";
const ENV = process.argv.includes("--prod") ? ".env.production.local" : ".env.local";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
const num = (v: any) => v == null ? null : Number(v);
const near = (a: any, b: any, tol: number) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;
const mnear = (a: any, b: any) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= Math.max(500, Math.abs(Number(b)) * 0.02);
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const depthOf = (pn: any) => { try { const o = typeof pn === "string" ? JSON.parse(pn) : pn; return o?.depthRole ?? null; } catch { return null; } };
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data } = await q.range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };

let issues = 0; const flag = (s: string) => { issues++; console.log(`  ❌ ${s}`); };

(async () => {
  // program → conference (school_team_id → Teams Table.id)
  const { data: cts } = await sb.from("customer_teams").select("id, name, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => c.school_team_id).filter(Boolean).map(String))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(), ctName = new Map<string, string>();
  for (const c of (cts || [])) { ctName.set(c.id, c.name); const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }

  const builds = await page("team_builds", "id, customer_team_id, is_active, is_default, team, academic_year, updated_at, created_at", (q) => q);
  const buildsByCt = new Map<string, any[]>(); for (const b of builds) { (buildsByCt.get(b.customer_team_id) ?? buildsByCt.set(b.customer_team_id, []).get(b.customer_team_id)!).push(b); }

  // ---- 1. exactly one active build per program + resolver agreement ----
  console.log("=== 1. active build per program ===");
  for (const [ctid, bs] of buildsByCt) {
    const actives = bs.filter((b) => b.is_active);
    if (actives.length !== 1) flag(`${ctName.get(ctid)}: ${actives.length} builds flagged is_active (want 1)`);
    const resolved = resolveActiveBuildId(bs);
    if (actives.length === 1 && resolved !== actives[0].id) flag(`${ctName.get(ctid)}: resolver picks ${resolved?.slice(0, 8)} ≠ is_active ${actives[0].id.slice(0, 8)}`);
  }
  console.log(`  programs: ${buildsByCt.size}`);

  // ---- 2. players meta ----
  const tb = await page("target_board", "player_id, customer_team_id, position_slot, transfer_snapshot, production_notes", (q) => q);
  const pids = [...new Set(tb.map((r: any) => r.player_id))];
  const pmeta = new Map<string, any>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position, is_twp").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) pmeta.set(p.id, p); }

  // ---- 3. target snapshot self-consistency + market (all programs) ----
  console.log("\n=== 2. target snapshot WAR-from-depth + market = f(WAR) at program tier (all programs) ===");
  let tChk = 0;
  for (const r of tb) {
    const conf = ctConf.get(r.customer_team_id); const s = r.transfer_snapshot; if (!s) continue;
    const meta = pmeta.get(r.player_id) || {}; const who = `${ctName.get(r.customer_team_id)}/${meta.first_name} ${meta.last_name}`;
    const isTwp = !!s.is_twp, ow = num(s.owar), pw = num(s.p_war), wrc = num(s.p_wrc_plus), rv = num(s.p_rv_plus);
    // WAR from stored depth
    if (ow != null && wrc != null && s.hitter_depth_role) { tChk++; const e = computeOWarFromWrcPlus(wrc, paForHitterDepthRole(s.hitter_depth_role)); if (!near(ow, e, 0.02)) flag(`${who}: oWAR ${ow.toFixed(3)} ≠ recompute(${s.hitter_depth_role})=${e?.toFixed(3)}`); }
    if (pw != null && rv != null && s.pitcher_depth_role) { tChk++; const e = computePitcherWar(Math.round(rv), pitcherExpectedIp(s.pitcher_depth_role, EQ), EQ); if (!near(pw, e, 0.03)) flag(`${who}: pWAR ${pw.toFixed(3)} ≠ recompute(${s.pitcher_depth_role})=${e?.toFixed(3)}`); }
    // market = f(WAR) at program tier
    if (conf) {
      if (ow != null) { const e = computeHitterMarketValue(ow, { conference: conf, position: meta.position }); const stored = isTwp ? num(s.twp_hitter_market_value) : num(s.nil_valuation); if (e != null && !mnear(stored, e)) flag(`${who}: hitter mkt ${stored == null ? "null" : Math.round(stored)} ≠ f(oWAR)=${Math.round(e)}`); }
      if (pw != null) { const e = computePitcherMarketValue(pw, { conference: conf, role: pitcherRoleFromDepthRole(s.pitcher_depth_role || "workhorse_reliever"), team: meta.last_name }, EQ); const stored = isTwp ? num(s.twp_pitcher_market_value) : num(s.nil_valuation); if (e != null && !mnear(stored, e)) flag(`${who}: pitcher mkt ${stored == null ? "null" : Math.round(stored)} ≠ f(pWAR)=${Math.round(e)}`); }
    }
    if (isTwp && num(s.nil_valuation) != null) flag(`${who}: TWP shared nil_valuation not null`);
  }
  console.log(`  target snapshots checked: ${tb.length} (WAR recomputes: ${tChk})`);

  // ---- 4. rostered target: board notes == active roster notes + 1:1 snapshot ----
  console.log("\n=== 3. rostered target: board notes == active-build roster notes + snapshot 1:1 (one-way) ===");
  let rChk = 0;
  for (const [ctid, bs] of buildsByCt) {
    const activeId = resolveActiveBuildId(bs); if (!activeId) continue;
    const bps = await page("team_build_players", "player_id, position_slot, included_in_roster, player_snapshot, production_notes", (q) => q.eq("build_id", activeId).eq("included_in_roster", true));
    const boardByPid = new Map((tb.filter((r: any) => r.customer_team_id === ctid)).map((r: any) => [r.player_id, r]));
    const byPid = new Map<string, any[]>(); for (const bp of bps) { if (!boardByPid.has(bp.player_id)) continue; (byPid.get(bp.player_id) ?? byPid.set(bp.player_id, []).get(bp.player_id)!).push(bp); }
    for (const [pid, list] of byPid) {
      if (list.length > 1) continue; // TWP phase 2
      rChk++; const board: any = boardByPid.get(pid); const rp = list[0]; const meta = pmeta.get(pid) || {};
      const who = `${ctName.get(ctid)}/${meta.first_name} ${meta.last_name}`;
      if (depthOf(rp.production_notes) !== depthOf(board.production_notes)) flag(`${who}: board notes depth "${depthOf(board.production_notes)}" ≠ roster "${depthOf(rp.production_notes)}"`);
      const ps = rp.player_snapshot || {}, ts = board.transfer_snapshot || {};
      // Classify by the snapshot's own data shape (a hitter carries o_war), not the
      // slot — a hitter mis-slotted into a pitcher slot must still compare as a hitter.
      const rpIsPit = num(ps.o_war) == null && num(ps.p_war) != null;
      if (rpIsPit) { if (!near(num(ps.p_war), num(ts.p_war), 0.02)) flag(`${who}: roster pWAR ${num(ps.p_war)?.toFixed(3)} ≠ board ${num(ts.p_war)?.toFixed(3)}`); }
      else { if (!near(num(ps.o_war), num(ts.owar ?? ts.o_war), 0.01)) flag(`${who}: roster oWAR ${num(ps.o_war)?.toFixed(3)} ≠ board ${num(ts.owar ?? ts.o_war)?.toFixed(3)}`); }
    }
  }
  console.log(`  rostered one-way targets checked: ${rChk}`);

  // ---- 4. TWP two-row: each TWP on a board = exactly 2 own-side rows ----
  console.log("\n=== 4. TWP two-row: exactly 2 own-side rows (hitter slot + pitcher slot) ===");
  const twpBoard = new Map<string, any[]>();
  for (const r of tb) { if (!pmeta.get(r.player_id)?.is_twp) continue; const k = `${r.player_id}|${r.customer_team_id}`; (twpBoard.get(k) ?? twpBoard.set(k, []).get(k)!).push(r); }
  let twpChk = 0;
  for (const [k, rows] of twpBoard) {
    const [pid, ctid] = k.split("|"); const meta = pmeta.get(pid) || {}; const who = `${ctName.get(ctid)}/${meta.first_name} ${meta.last_name}`;
    twpChk++;
    if (rows.length !== 2) { flag(`${who}: TWP has ${rows.length} board rows (want 2)`); continue; }
    const h = rows.find((r: any) => !isPit(r.position_slot)), p = rows.find((r: any) => isPit(r.position_slot));
    if (!h || !p) { flag(`${who}: TWP rows not one-hitter-one-pitcher (slots ${rows.map((r: any) => r.position_slot)})`); continue; }
    const hs = h.transfer_snapshot || {}, ps = p.transfer_snapshot || {};
    if (num(hs.p_war) != null || num(hs.twp_pitcher_market_value) != null) flag(`${who}: hitter row carries pitcher data`);
    if (num(ps.owar) != null || num(ps.twp_hitter_market_value) != null) flag(`${who}: pitcher row carries hitter data`);
    if (num(hs.owar) == null) flag(`${who}: hitter row missing owar`);
    if (num(ps.p_war) == null) flag(`${who}: pitcher row missing p_war`);
  }
  console.log(`  TWP (player,team) groups checked: ${twpChk}`);

  // ---- 5. no zeroed markets (positive WAR but stored market ~$0) — roster + target ----
  // Catches the eligibility-gate class (e.g. a pitcher neutral missing market_value →
  // dirty recompute returns $0 → saved). Only flags the unambiguous zeroed case, so no
  // false positives on position/tier market wobble.
  console.log("\n=== 5. no zeroed markets (positive WAR, stored market ~$0) — roster + target ===");
  const buildConf = new Map<string, string>(); for (const b of builds) { const cf = ctConf.get(b.customer_team_id); if (cf) buildConf.set(b.id, cf); }
  const allBps = await page("team_build_players", "player_id, build_id, position_slot, player_snapshot", (q) => q);
  const need = [...new Set(allBps.map((r: any) => r.player_id).filter((id: any) => id && !pmeta.has(id) && /^[0-9a-f-]{36}$/i.test(String(id))))];
  for (let i = 0; i < need.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position, is_twp").in("id", need.slice(i, i + 200)); for (const p of (data || [])) pmeta.set(p.id, p); }
  let zChk = 0;
  const checkZero = (who: string, side: "P" | "H", war: number | null, conf: string | undefined, position: string | undefined, depthRole: string | null, lastName: string, storedMkt: number | null) => {
    if (war == null || war <= 0 || !conf) return; zChk++;
    const e = side === "P"
      ? computePitcherMarketValue(war, { conference: conf, role: pitcherRoleFromDepthRole(depthRole || "workhorse_reliever"), team: lastName }, EQ)
      : computeHitterMarketValue(war, { conference: conf, position });
    if (e != null && e > 1000 && (storedMkt == null || storedMkt < 1)) flag(`${who}: ${side === "P" ? "pitcher" : "hitter"} market ~$0 but should be ~$${Math.round(e)} (WAR ${war.toFixed(2)})`);
  };
  for (const r of allBps) {
    const s = r.player_snapshot; if (!s) continue; const meta = pmeta.get(r.player_id) || {}; const isTwp = !!s.is_twp;
    const side: "P" | "H" = isPit(r.position_slot ?? (num(s.p_rv_plus) != null ? "SP" : "")) ? "P" : "H";
    checkZero(meta.first_name + " " + meta.last_name, side, side === "P" ? num(s.p_war) : num(s.o_war), buildConf.get(r.build_id), meta.position, s.pitcher_depth_role, meta.last_name,
      side === "P" ? (isTwp ? num(s.twp_pitcher_market_value) : num(s.market_value)) : (isTwp ? num(s.twp_hitter_market_value) : num(s.market_value)));
  }
  for (const r of tb) {
    const s = r.transfer_snapshot; if (!s) continue; const meta = pmeta.get(r.player_id) || {}; const isTwp = !!s.is_twp;
    const side: "P" | "H" = isPit(r.position_slot ?? (num(s.p_rv_plus) != null ? "SP" : "")) ? "P" : "H";
    checkZero(`${ctName.get(r.customer_team_id)}/${meta.first_name} ${meta.last_name}`, side, side === "P" ? num(s.p_war) : num(s.owar ?? s.o_war), ctConf.get(r.customer_team_id), meta.position, s.pitcher_depth_role, meta.last_name,
      side === "P" ? (isTwp ? num(s.twp_pitcher_market_value) : num(s.nil_valuation)) : (isTwp ? num(s.twp_hitter_market_value) : num(s.nil_valuation)));
  }
  console.log(`  snapshots market-checked for zeroing: ${zChk}`);

  console.log(`\n===== ${issues === 0 ? "✅ ALL CONSISTENT — 0 issues across all programs" : `❌ ${issues} issue(s)`} =====`);
})();
