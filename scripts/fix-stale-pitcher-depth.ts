/**
 * Re-derive the pitcher depth role from real (Pitching Master) IP where the stored
 * depth is stale vs the code (`derivePitcherStored`) — the IP<10 SP → specialist_reliever
 * class (memory: project_pitcher_role_systemic_fix). Cascades projected_ip / p_war /
 * market via the SAME code the precompute uses, so stored == live. Excludes rows with a
 * pitcher_role_override (coach-owned). Touches player_predictions only; snapshots are
 * re-synced separately (backfill-neutral + heal) after this.
 *
 *   npx tsx scripts/fix-stale-pitcher-depth.ts [--prod] [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { derivePitcherStored } from "../src/lib/predictionEngine";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";
import { CURRENT_SEASON } from "../src/lib/seasonConstants";
const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ENV = PROD ? ".env.production.local" : ".env.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const url = rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL");
if (PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("--prod but URL not prod."); process.exit(1); }
if (!PROD && /trbvxuoliwrfowibatkm/.test(url)) { console.error("no --prod but URL looks prod."); process.exit(1); }
const sb = createClient(url, rd("SUPABASE_SERVICE_ROLE_KEY"));
const n = (v: any) => (v == null ? null : Number(v));

(async () => {
  console.log(`### ${PROD ? "PROD" : "STAGING"} ${APPLY ? "APPLY" : "DRY-RUN"} — re-derive stale pitcher depth (season ${CURRENT_SEASON} IP) ###`);
  const tc = new Map<string, string>(); { let f = 0; for (;;) { const { data } = await sb.from("Teams Table").select("id,conference").order("id").range(f, f + 999); for (const t of (data || [])) if (t.conference) tc.set(String(t.id), t.conference); if (!data || data.length < 1000) break; f += 1000; } }
  const { data: cts } = await sb.from("customer_teams").select("id,school_team_id"); const ct = new Map<string, string>(); for (const c of (cts || [])) { const cf = tc.get(String(c.school_team_id)); if (cf) ct.set(c.id, cf); }
  const pc = new Map<string, string>(), pt = new Map<string, string>(), pp = new Map<string, string>(), psrc = new Map<string, string>(), ptw = new Set<string>();
  { let f = 0; for (;;) { const { data } = await sb.from("players").select("id,team_id,team,position,source_player_id,is_twp").order("id").range(f, f + 999); for (const p of (data || [])) { if (p.team_id && tc.get(String(p.team_id))) pc.set(p.id, tc.get(String(p.team_id))!); if (p.team) pt.set(p.id, p.team); if (p.position != null) pp.set(p.id, p.position); if (p.source_player_id) psrc.set(p.id, String(p.source_player_id)); if (p.is_twp) ptw.add(p.id); } if (!data || data.length < 1000) break; f += 1000; } }
  const posIsPitcher = (id: string) => /^(SP|RP|CL|P|LHP|RHP)$/i.test(String(pp.get(id) ?? ""));
  const pmIp = new Map<string, number>(); { let f = 0; for (;;) { const { data } = await sb.from("Pitching Master").select("source_player_id,IP").eq("Season", CURRENT_SEASON).range(f, f + 999); for (const r of (data || [])) if (r.source_player_id != null) pmIp.set(String(r.source_player_id), Number(r.IP) || 0); if (!data || data.length < 1000) break; f += 1000; } }
  const ov = new Set<string>(); { const { data } = await sb.from("pitcher_role_overrides").select("player_id"); for (const o of (data || [])) ov.add(o.player_id); }

  const fixes: { id: string; patch: any; note: string }[] = []; const byPair = new Map<string, number>(); let noIp = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions").select("id, player_id, customer_team_id, pitcher_role, pitcher_depth_role, hitter_depth_role, p_rv_plus, p_war, projected_ip, market_value, twp_pitcher_market_value").eq("season", 2027).not("pitcher_depth_role", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data || [])) {
      if (ov.has(r.player_id)) continue;                     // coach override — leave
      const src = psrc.get(r.player_id); const ip = src != null ? pmIp.get(src) : undefined; if (ip == null) { noIp++; continue; }
      const conf = r.customer_team_id ? (ct.get(r.customer_team_id) ?? null) : (pc.get(r.player_id) ?? null);
      const role = (r.pitcher_role === "SP" || r.pitcher_role === "RP" || r.pitcher_role === "SM") ? r.pitcher_role : "RP";
      const tw = ptw.has(r.player_id);
      const d = derivePitcherStored(n(r.p_rv_plus), role as any, { conference: conf, team: pt.get(r.player_id) ?? null, is_twp: tw, ip }, EQ);
      if (d.pitcher_depth_role === r.pitcher_depth_role) continue; // depth already correct
      const patch: any = { pitcher_depth_role: d.pitcher_depth_role, projected_ip: d.projected_ip, p_war: d.p_war };
      // Position-ownership guard: only write the shared market_value on a non-TWP row
      // if this player is pitcher-primary (pitcher position, or no hitter side). Otherwise
      // market_value belongs to the hitter side — never clobber it with the pitcher market.
      if (tw) patch.twp_pitcher_market_value = (d as any).twp_pitcher_market_value;
      else if (posIsPitcher(r.player_id) || !r.hitter_depth_role) patch.market_value = d.market_value;
      byPair.set(`${r.pitcher_depth_role}→${d.pitcher_depth_role}`, (byPair.get(`${r.pitcher_depth_role}→${d.pitcher_depth_role}`) || 0) + 1);
      fixes.push({ id: r.id, patch, note: `${r.pitcher_depth_role}→${d.pitcher_depth_role} ip=${ip} pWAR ${n(r.p_war)?.toFixed(2)}→${n(d.p_war)?.toFixed(2)}` });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`rows to re-derive: ${fixes.length} (skipped: overrides + ${noIp} no-PM-IP)`);
  for (const [k, c] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${c}× ${k}`);
  fixes.slice(0, 5).forEach((f) => console.log(`   e.g. ${f.note}`));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const f of fixes) { const { error } = await sb.from("player_predictions").update(f.patch).eq("id", f.id); if (error) console.error("err", f.id, error.message); else if (++done % 200 === 0) process.stdout.write(`\r  ${done}/${fixes.length}`); }
  console.log(`\n✅ re-derived depth + cascaded ${done}/${fixes.length} pitcher rows`);
})();