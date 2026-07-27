/**
 * Canonical recompute of the DERIVED cascade on player_predictions, from the
 * EXISTING stats (rates/rv+/wrc+ untouched), in the sanctioned order:
 *   1. round pRV+ / wRC+ to whole
 *   2. projected_ip = pitcherExpectedIp(pitcher_depth_role)   [stored depth, unchanged]
 *   3. pWAR = computePitcherWar(round pRV+, IP);  oWAR = computeHitterOWar(round wRC+, depth)
 *   4. market = computePitcher/HitterMarketValue(WAR, canonical tier)   ← LAST
 *
 * Canonical conference (mirrors fix-pitcher-market-pvf EXACTLY):
 *   customer_team_id → destination conf (customer_teams.school_team_id → Teams Table.conference)
 *   else (global/returner) → players.conference   ← the field, NOT team_id→Teams Table
 * TWP rows route market to twp_pitcher/twp_hitter_market_value.
 *
 * Does NOT touch any rate (p_era/fip/whip/k9/bb9/hr9/avg/obp/slg), depth role,
 * class_transition, or scouting scores. Rates are the separate re-run.
 *
 * VALIDATION: run on staging first — it should report ~0 changes (staging is the
 * canonical reference). Only apply to prod once staging proves the logic canonical.
 *
 *   npx tsx scripts/recompute-derived-cascade.ts            # dry-run staging
 *   npx tsx scripts/recompute-derived-cascade.ts --apply
 *   add --prod for prod (guarded).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { pitcherExpectedIp, computePitcherWar, computeHitterOWar, computeHitterMarketValue, computePitcherMarketValue, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";

const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ENV = PROD ? ".env.production.local" : ".env.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const url = rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL");
if (PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("--prod but URL not prod."); process.exit(1); }
if (!PROD && /trbvxuoliwrfowibatkm/.test(url)) { console.error("no --prod but URL looks prod."); process.exit(1); }
const sb = createClient(url, rd("SUPABASE_SERVICE_ROLE_KEY"));
const n = (v: any) => (v == null ? null : Number(v));
// Tight: p_war/o_war must land on the EXACT recompute so market (derived from it)
// stays consistent. 1e-6 absorbs pure float-storage noise only.
const nearWar = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
const nearM = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.005 * Math.abs(b));

(async () => {
  console.log(`### ${PROD ? "PROD" : "STAGING"}  ${APPLY ? "APPLY" : "DRY-RUN"}  (canonical derived cascade) ###`);
  // conference maps — resolution that MATCHES STAGING (empirically validated):
  //   transfer (customer_team_id) → destination: customer_teams.school_team_id → Teams Table.conference
  //   global/returner            → the player's OWN team: players.team_id → Teams Table.conference
  // (NOT players.conference, which is null for most rows and diverges from staging.)
  const teamConf = new Map<string, string>();          // FULL Teams Table id → conference
  { let f = 0; for (;;) { const { data } = await sb.from("Teams Table").select("id, conference").order("id").range(f, f + 999); for (const t of (data || [])) if (t.conference) teamConf.set(String(t.id), t.conference); if (!data || data.length < 1000) break; f += 1000; } }
  const { data: cts } = await sb.from("customer_teams").select("id, school_team_id");
  const ctConf = new Map<string, string>(); for (const c of (cts || [])) { const cf = teamConf.get(String(c.school_team_id)); if (cf) ctConf.set(c.id, cf); }
  const pconf = new Map<string, string>(), ppos = new Map<string, string>(), pteam = new Map<string, string>(), ptwp = new Set<string>();
  { let f = 0; for (;;) { const { data } = await sb.from("players").select("id, team_id, position, team, is_twp").order("id").range(f, f + 999); for (const p of (data || [])) { if (p.team_id && teamConf.get(String(p.team_id))) pconf.set(p.id, teamConf.get(String(p.team_id))!); if (p.position) ppos.set(p.id, p.position); if (p.team) pteam.set(p.id, p.team); if (p.is_twp) ptwp.add(p.id); } if (!data || data.length < 1000) break; f += 1000; } }
  const rowConf = (r: any) => r.customer_team_id ? (ctConf.get(r.customer_team_id) ?? null) : (pconf.get(r.player_id) ?? null);

  let scanned = 0, rvR = 0, wrcR = 0, ipF = 0, pwF = 0, owF = 0, pmF = 0, hmF = 0, noConf = 0;
  const updates: { id: string; patch: any }[] = [];
  const sample: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, player_id, customer_team_id, pitcher_role, pitcher_depth_role, hitter_depth_role, p_rv_plus, p_wrc_plus, projected_ip, p_war, o_war, market_value, twp_pitcher_market_value, twp_hitter_market_value")
      .eq("season", 2027).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data || [])) {
      scanned++;
      const conf = rowConf(r);
      const isTwp = ptwp.has(r.player_id);
      const patch: any = {};
      // ---- PITCHER ----
      if (r.pitcher_depth_role && n(r.p_rv_plus) != null) {
        const rvWhole = Math.round(Number(r.p_rv_plus));
        if (Number(r.p_rv_plus) !== rvWhole) { patch.p_rv_plus = rvWhole; rvR++; }
        const ip = pitcherExpectedIp(r.pitcher_depth_role as any, EQ);
        if (n(r.projected_ip) == null || Math.abs(Number(r.projected_ip) - ip) > 0.5) { patch.projected_ip = ip; ipF++; }
        const pWar = computePitcherWar(rvWhole, ip, EQ);
        if (pWar != null && (n(r.p_war) == null || !nearWar(Number(r.p_war), pWar))) { patch.p_war = pWar; pwF++; }
        // market derived from the FINAL stored WAR (updated value if we wrote it, else current)
        const finalPWar = pWar ?? n(r.p_war);
        if (conf != null && finalPWar != null) {
          const m = computePitcherMarketValue(finalPWar, { conference: conf, role: pitcherRoleFromDepthRole(r.pitcher_depth_role as any), team: pteam.get(r.player_id) ?? "x" }, EQ);
          const stored = isTwp ? n(r.twp_pitcher_market_value) : n(r.market_value);
          if (m != null && stored != null && !nearM(stored, m)) { if (isTwp) patch.twp_pitcher_market_value = m; else patch.market_value = m; pmF++; }
        }
      }
      // ---- HITTER ----
      if (r.hitter_depth_role && n(r.p_wrc_plus) != null) {
        const wrcWhole = Math.round(Number(r.p_wrc_plus));
        if (Number(r.p_wrc_plus) !== wrcWhole) { patch.p_wrc_plus = wrcWhole; wrcR++; }
        const oWar = computeHitterOWar(wrcWhole, null, r.hitter_depth_role as any);
        if (oWar != null && (n(r.o_war) == null || !nearWar(Number(r.o_war), oWar))) { patch.o_war = oWar; owF++; }
        const finalOWar = oWar ?? n(r.o_war);
        if (conf != null && finalOWar != null) {
          const m = computeHitterMarketValue(finalOWar, { conference: conf, position: ppos.get(r.player_id) });
          const stored = isTwp ? n(r.twp_hitter_market_value) : n(r.market_value);
          if (m != null && stored != null && !nearM(stored, m)) { if (isTwp) patch.twp_hitter_market_value = m; else patch.market_value = m; hmF++; }
        }
      }
      if (conf == null && (r.pitcher_depth_role || r.hitter_depth_role)) noConf++;
      if (Object.keys(patch).length) {
        updates.push({ id: r.id, patch });
        if (sample.length < 8) sample.push(`  ${Object.entries(patch).map(([k, v]) => `${k}=${typeof v === "number" ? Math.round(v as number) : v}`).join(" ")}`);
      }
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`scanned ${scanned}  rows to update ${updates.length}  (pRV+round ${rvR}, wRC+round ${wrcR}, IP ${ipF}, pWAR ${pwF}, oWAR ${owF}, pMkt ${pmF}, hMkt ${hmF}, noConf ${noConf})`);
  console.log("samples:"); sample.forEach((s) => console.log(s));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0; const CHUNK = 25;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    await Promise.all(slice.map(async (u) => { const { error } = await sb.from("player_predictions").update(u.patch).eq("id", u.id); if (error) console.error("err", u.id, error.message); else done++; }));
    if (i % 5000 < CHUNK) console.log(`${done}/${updates.length}`);
  }
  console.log(`✅ applied ${done}/${updates.length} (derived cascade; rates untouched)`);
})();
