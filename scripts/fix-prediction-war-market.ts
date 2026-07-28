/**
 * Deterministic cleanup of player_predictions WAR + market to the current formulas,
 * WITHOUT re-running rates:
 *   - pitcher p_war  = computePitcherWar(round(p_rv_plus), projected_ip)   [whole pRV+ convention]
 *   - pitcher market = computePitcherMarketValue(p_war, conf/role/team)    [PVF dropped]
 *   - hitter  market = computeHitterMarketValue(o_war, conf/position)      [IF posMult 1.1]
 * (hitter o_war already verified consistent — not recomputed.)
 *
 * Market conference: returner-GLOBAL → player's own team conf; team-scoped → customer team conf.
 * TWP rows route to twp_pitcher/twp_hitter_market_value. Only updates a field when the
 * new value differs and the recompute is non-null (never nulls an existing market).
 *
 *   npx tsx scripts/fix-prediction-war-market.ts            # dry-run (staging)
 *   npx tsx scripts/fix-prediction-war-market.ts --apply
 *   add --prod for prod (guarded).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computePitcherWar, computePitcherMarketValue, computeHitterMarketValue, pitcherRoleFromDepthRole } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";

const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ENV = PROD ? ".env.production.local" : ".env.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const url = rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL");
if (PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("--prod but URL not prod. Refusing."); process.exit(1); }
if (!PROD && /trbvxuoliwrfowibatkm/.test(url)) { console.error("no --prod but URL looks prod. Refusing."); process.exit(1); }
const sb = createClient(url, rd("SUPABASE_SERVICE_ROLE_KEY"));
const n = (v: any) => (v == null ? null : Number(v));
const nearWar = (a: number, b: number) => Math.abs(a - b) <= 0.02;               // pWAR: absolute
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(50, 0.005 * Math.abs(b)); // $: relative

(async () => {
  console.log(`### ${PROD ? "PROD" : "STAGING"}  ${APPLY ? "APPLY" : "DRY-RUN"}  (predictions WAR+market cleanup) ###`);
  const tconf = new Map<string, string>(); { let f = 0; for (;;) { const { data } = await sb.from("Teams Table").select("id,conference").order("id").range(f, f + 999); for (const t of (data || [])) if (t.conference) tconf.set(String(t.id), t.conference); if (!data || data.length < 1000) break; f += 1000; } }
  const pconf = new Map<string, string>(), ppos = new Map<string, string>(), pteam = new Map<string, string>(), ptwp = new Set<string>();
  { let f = 0; for (;;) { const { data } = await sb.from("players").select("id,team_id,position,team,is_twp").order("id").range(f, f + 999); for (const p of (data || [])) { if (p.team_id && tconf.get(String(p.team_id))) pconf.set(p.id, tconf.get(String(p.team_id))!); if (p.position) ppos.set(p.id, p.position); if (p.team) pteam.set(p.id, p.team); if (p.is_twp) ptwp.add(p.id); } if (!data || data.length < 1000) break; f += 1000; } }
  const ctconf = new Map<string, string>(); { const { data: cts } = await sb.from("customer_teams").select("id,school_team_id"); for (const c of (cts || [])) { const cf = tconf.get(String(c.school_team_id)); if (cf) ctconf.set(c.id, cf); } }

  let warFix = 0, pMktFix = 0, hMktFix = 0, noConf = 0, scanned = 0;
  const updates: { id: string; patch: any }[] = [];
  const sample: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, customer_team_id, player_id, pitcher_depth_role, hitter_depth_role, projected_ip, p_rv_plus, p_war, o_war, market_value, twp_pitcher_market_value, twp_hitter_market_value")
      .eq("season", 2027).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data || [])) {
      scanned++;
      const conf = r.customer_team_id ? ctconf.get(r.customer_team_id) : pconf.get(r.player_id);
      const patch: any = {};
      // pitcher WAR (whole rv+) + market
      if (r.pitcher_depth_role && n(r.p_rv_plus) != null && n(r.projected_ip) != null) {
        const newWar = computePitcherWar(Math.round(Number(r.p_rv_plus)), Number(r.projected_ip), EQ);
        if (newWar != null && (n(r.p_war) == null || !nearWar(Number(r.p_war), newWar))) { patch.p_war = newWar; warFix++; }
        const war = newWar ?? n(r.p_war);
        if (conf && war != null) {
          const m = computePitcherMarketValue(war, { conference: conf, role: pitcherRoleFromDepthRole(r.pitcher_depth_role as any), team: pteam.get(r.player_id) ?? "x" }, EQ);
          const stored = ptwp.has(r.player_id) ? n(r.twp_pitcher_market_value) : n(r.market_value);
          if (m != null && stored != null && !near(stored, m)) {
            if (ptwp.has(r.player_id)) patch.twp_pitcher_market_value = m; else patch.market_value = m;
            pMktFix++;
          }
        }
      }
      // hitter market (o_war already correct)
      if (r.hitter_depth_role && n(r.o_war) != null && conf) {
        const m = computeHitterMarketValue(Number(r.o_war), { conference: conf, position: ppos.get(r.player_id) });
        const stored = ptwp.has(r.player_id) ? n(r.twp_hitter_market_value) : n(r.market_value);
        if (m != null && stored != null && !near(stored, m)) {
          if (ptwp.has(r.player_id)) patch.twp_hitter_market_value = m; else patch.market_value = m;
          hMktFix++;
        }
      }
      if (!conf && (r.pitcher_depth_role || r.hitter_depth_role)) noConf++;
      if (Object.keys(patch).length) {
        updates.push({ id: r.id, patch });
        if (sample.length < 10) sample.push(`  ${Object.entries(patch).map(([k, v]) => `${k}=${typeof v === "number" ? Math.round(v as number) : v}`).join(" ")}`);
      }
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`scanned ${scanned}   rows to update ${updates.length}   (pWAR ${warFix}, pMkt ${pMktFix}, hMkt ${hMktFix}, noConf ${noConf})`);
  console.log("samples:"); sample.forEach((s) => console.log(s));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const u of updates) {
    const { error } = await sb.from("player_predictions").update(u.patch).eq("id", u.id);
    if (error) console.error("err", u.id, error.message);
    else if (++done % 1000 === 0) process.stdout.write(`\r  ${done}/${updates.length}`);
  }
  console.log(`\n✅ updated ${done}/${updates.length} prediction rows (WAR/market only; rates untouched)`);
})();
