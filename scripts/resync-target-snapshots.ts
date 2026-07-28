/**
 * Resync target_board.transfer_snapshot after the upstream pitcher-market fix:
 *   1. Recompute MARKET fields in place from each snapshot's own stored WAR at the
 *      program's conference tier (+ position for hitters) — canonical fns, no PVF.
 *      This preserves any toggled WAR (unlike a full re-copy from predictions),
 *      and makes market an exact function of the displayed WAR.
 *   2. Stamp hitter_depth_role / pitcher_depth_role so a target row is
 *      WAR-recomputable + self-heal-able, like the build player_snapshot already is.
 *      Depth = production_notes.depthRole when a toggle is set, else derived as the
 *      role whose PA/IP reproduces the stored WAR (self-consistent).
 *
 *   npx tsx scripts/resync-target-snapshots.ts [--all] [--apply]
 *   (default scope = Georgia; --all = every program's board)
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computeHitterMarketValue, computePitcherMarketValue, computePitcherWar, paForHitterDepthRole, pitcherExpectedIp, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { computeOWarFromWrcPlus } from "../src/lib/playerCalcs";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
const ENV = process.argv.includes("--prod") ? ".env.production.local" : ".env.local";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
const APPLY = process.argv.includes("--apply"), ALL = process.argv.includes("--all");
const GA = "3b1cc0e2-4acd-4a27-a7bc-d345c347f18d";
const num = (v: any) => v == null ? null : Number(v);
const HIT_ROLES = ["cornerstone", "everyday_starter", "platoon_starter", "utility", "bench"];
const PIT_ROLES = ["weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"];
const notesDepth = (pn: any) => { try { const o = typeof pn === "string" ? JSON.parse(pn) : pn; return o?.depthRole ?? null; } catch { return null; } };
// depth role whose PA/IP reproduces the stored WAR
const deriveHitDepth = (owar: number, wrc: number) => HIT_ROLES.map((r) => [r, Math.abs(computeOWarFromWrcPlus(wrc, paForHitterDepthRole(r)) - owar)] as const).sort((a, b) => a[1] - b[1])[0][0];
const derivePitDepth = (pwar: number, rv: number) => PIT_ROLES.map((r) => [r, Math.abs((computePitcherWar(Math.round(rv), pitcherExpectedIp(r, EQ), EQ) ?? 0) - pwar)] as const).sort((a, b) => a[1] - b[1])[0][0];

(async () => {
  // customer_team_id → conference
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const teamIds = [...new Set((cts || []).map((c: any) => c.school_team_id).filter(Boolean).map(String))];
  const teamConf = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) { const { data } = await sb.from("Teams Table").select("id, conference").in("id", teamIds.slice(i, i + 200)); for (const t of (data || [])) teamConf.set(String(t.id), t.conference); }
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }

  let q = sb.from("target_board").select("id, player_id, customer_team_id, transfer_snapshot, production_notes");
  if (!ALL) q = q.eq("customer_team_id", GA);
  const { data: tb } = await q;
  const pids = [...new Set((tb || []).map((r: any) => r.player_id))];
  const pos = new Map<string, string>(), name = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, position").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) { pos.set(p.id, p.position); name.set(p.id, `${p.first_name} ${p.last_name}`); } }

  // predictions (for the precompute's TRUE depth roles — same source the add-path uses).
  // Paginate WITHIN each batch + order by id (the .in() cap / arbitrary-order trap).
  let preds: any[] = [];
  for (let i = 0; i < pids.length; i += 100) { const batch = pids.slice(i, i + 100); let f = 0; for (;;) { const { data, error } = await sb.from("player_predictions").select("player_id, customer_team_id, variant, model_type, hitter_depth_role, pitcher_depth_role").eq("season", 2027).in("player_id", batch).order("id").range(f, f + 999); if (error) throw error; preds = preds.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } }
  const byPlayer = new Map<string, any[]>(); for (const p of preds) { (byPlayer.get(p.player_id) ?? byPlayer.set(p.player_id, []).get(p.player_id)!).push(p); }
  const pickDepth = (pid: string, ctid: string) => { const rows = byPlayer.get(pid) || []; return rows.find((r) => r.customer_team_id === ctid && r.variant === "precomputed") ?? rows.find((r) => r.model_type === "returner" && r.variant === "regular" && r.customer_team_id == null) ?? rows.find((r) => r.customer_team_id === ctid) ?? rows[0] ?? null; };

  let changed = 0, mktFix = 0, depthAdd = 0, noConf = 0;
  const updates: { id: string; transfer_snapshot: any }[] = [], samples: string[] = [];
  for (const r of (tb || [])) {
    const conf = ctConf.get(r.customer_team_id);
    if (!conf) { noConf++; continue; }
    const s = { ...(r.transfer_snapshot || {}) };
    const before = JSON.stringify(s);
    const isTwp = !!s.is_twp;
    const owar = num(s.owar), pwar = num(s.p_war), wrc = num(s.p_wrc_plus), rv = num(s.p_rv_plus);
    const nd = notesDepth(r.production_notes);

    // --- market (exact f(WAR) at program tier) ---
    const hMkt = owar != null ? computeHitterMarketValue(owar, { conference: conf, position: pos.get(r.player_id) }) : null;
    const pMkt = pwar != null ? computePitcherMarketValue(pwar, { conference: conf, role: pitcherRoleFromDepthRole(nd || (pwar != null && rv != null ? derivePitDepth(pwar, rv) : "workhorse_reliever")), team: name.get(r.player_id) ?? null }, EQ) : null;
    if (isTwp) { s.twp_hitter_market_value = hMkt; s.twp_pitcher_market_value = pMkt; s.nil_valuation = null; }
    else { s.nil_valuation = owar != null ? hMkt : pMkt; s.twp_hitter_market_value = null; s.twp_pitcher_market_value = null; }

    // --- depth roles: production_notes override → precompute's stored role IF it
    //     reproduces the stored WAR (true label, resolves same-IP ties) →
    //     WAR-derived fallback when the stored label is stale vs its own WAR ---
    const pd = pickDepth(r.player_id, r.customer_team_id);
    const hitStoredOk = pd?.hitter_depth_role && owar != null && wrc != null && Math.abs(computeOWarFromWrcPlus(wrc, paForHitterDepthRole(pd.hitter_depth_role)) - owar) <= 0.02;
    const pitStoredOk = pd?.pitcher_depth_role && pwar != null && rv != null && Math.abs((computePitcherWar(Math.round(rv), pitcherExpectedIp(pd.pitcher_depth_role, EQ), EQ) ?? 0) - pwar) <= 0.03;
    if (owar != null && wrc != null) s.hitter_depth_role = (nd && HIT_ROLES.includes(nd)) ? nd : (hitStoredOk ? pd.hitter_depth_role : deriveHitDepth(owar, wrc));
    if (pwar != null && rv != null) s.pitcher_depth_role = (nd && PIT_ROLES.includes(nd)) ? nd : (pitStoredOk ? pd.pitcher_depth_role : derivePitDepth(pwar, rv));

    if (JSON.stringify(s) !== before) {
      changed++;
      const hadDepth = ("hitter_depth_role" in (r.transfer_snapshot || {})) || ("pitcher_depth_role" in (r.transfer_snapshot || {}));
      if (!hadDepth) depthAdd++;
      // did a market field move?
      const os = r.transfer_snapshot || {};
      if (num(os.nil_valuation) !== num(s.nil_valuation) || num(os.twp_hitter_market_value) !== num(s.twp_hitter_market_value) || num(os.twp_pitcher_market_value) !== num(s.twp_pitcher_market_value)) mktFix++;
      updates.push({ id: r.id, transfer_snapshot: s });
      if (samples.length < 18) samples.push(`  ${name.get(r.player_id)}${isTwp ? " (TWP)" : ""}: ${owar != null ? `oWAR ${owar.toFixed(3)}→H$${hMkt == null ? "—" : Math.round(hMkt)}/${s.hitter_depth_role}` : ""} ${pwar != null ? `pWAR ${pwar.toFixed(3)}→P$${pMkt == null ? "—" : Math.round(pMkt)}/${s.pitcher_depth_role}` : ""}`);
    }
  }
  console.log(`scope=${ALL ? "ALL" : "Georgia"}  target rows=${tb?.length}  changed=${changed}  (market fixed=${mktFix}, depth added=${depthAdd})  noConf=${noConf}`);
  console.log("samples:"); samples.forEach((s) => console.log(s));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  for (let i = 0; i < updates.length; i++) { const { error } = await sb.from("target_board").update({ transfer_snapshot: updates[i].transfer_snapshot }).eq("id", updates[i].id); if (error) console.log("err", updates[i].id, error.message); if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i + 1}/${updates.length}`); }
  console.log(`\n✅ applied ${updates.length}`);
})();
