/**
 * SURGICAL cascade: fix `projected_ip` on returner-global pitcher rows to match the
 * depth role, then CASCADE that into p_war and market — WITHOUT rewriting any rate
 * (p_era/fip/whip/k9/bb9/hr9/rv+), the depth role, class, or scouting scores. The
 * full rate projections are being re-run separately.
 *
 *   projected_ip = pitcherExpectedIp(pitcher_depth_role)          [depth role unchanged]
 *   p_war        = computePitcherWar(existing p_rv_plus, new IP)  [rv+ unchanged]
 *   market       = old_market × (new_pWAR / old_pWAR)             [linear in pWAR →
 *                  exact; preserves tier/PVF/eligibility gating]. TWP → twp_pitcher_market_value.
 *
 * Scope: model_type='returner', variant='regular', customer_team_id=NULL, season 2027,
 *        pitcher_depth_role NOT NULL, projected_ip ≠ pitcherExpectedIp(depth).
 *
 *   npx tsx scripts/fix-returner-projected-ip.ts            # dry-run
 *   npx tsx scripts/fix-returner-projected-ip.ts --apply    # write (staging by env)
 *   add --prod to target prod (guarded).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { pitcherExpectedIp, computePitcherWar } from "../src/lib/depthRoles";
import { DEFAULT_PITCHING_WEIGHTS as EQ } from "../src/lib/pitchingEquations";

const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ENV = PROD ? ".env.production.local" : ".env.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const url = rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL");
if (PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("--prod but URL is not prod. Refusing."); process.exit(1); }
if (!PROD && /trbvxuoliwrfowibatkm/.test(url)) { console.error("no --prod but URL looks prod. Refusing."); process.exit(1); }
const sb = createClient(url, rd("SUPABASE_SERVICE_ROLE_KEY"));
const num = (v: any) => (v == null ? null : Number(v));

(async () => {
  console.log(`### ${PROD ? "PROD" : "STAGING"}  ${APPLY ? "APPLY" : "DRY-RUN"}  (projected_ip → pWAR → market cascade) ###`);
  let rows: any[] = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, pitcher_depth_role, projected_ip, p_rv_plus, p_war, market_value, twp_pitcher_market_value")
      .eq("season", 2027).eq("model_type", "returner").eq("variant", "regular")
      .is("customer_team_id", null).not("pitcher_depth_role", "is", null)
      .order("id").range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const fixes: { id: string; patch: any; depth: string; note: string }[] = [];
  const byDepth = new Map<string, number>();
  let noRv = 0;
  for (const r of rows) {
    const exp = pitcherExpectedIp(r.pitcher_depth_role as any, EQ);
    const curIp = num(r.projected_ip);
    if (curIp != null && Math.abs(curIp - exp) <= 0.5) continue;      // IP already correct
    const rv = num(r.p_rv_plus);
    const patch: any = { projected_ip: exp };
    let note = `ip ${curIp}→${exp}`;
    if (rv != null) {
      const oldWar = num(r.p_war);
      const newWar = computePitcherWar(Math.round(rv), exp, EQ);
      patch.p_war = newWar;
      // market scales linearly with pWAR (market = pWAR × $/WAR × tier); scaling by the
      // pWAR ratio preserves the row's tier/PVF/eligibility gating exactly.
      const ratio = oldWar != null && oldWar !== 0 && newWar != null ? newWar / oldWar : null;
      if (ratio != null) {
        if (num(r.market_value) != null) patch.market_value = Number(r.market_value) * ratio;
        if (num(r.twp_pitcher_market_value) != null) patch.twp_pitcher_market_value = Number(r.twp_pitcher_market_value) * ratio;
      }
      note += `, pWAR ${oldWar?.toFixed(3)}→${newWar?.toFixed(3)}`;
      if (patch.market_value != null) note += `, $${Math.round(Number(r.market_value))}→${Math.round(patch.market_value)}`;
    } else { noRv++; note += ` (no rv+ → IP only)`; }
    fixes.push({ id: r.id, patch, depth: r.pitcher_depth_role, note });
    byDepth.set(r.pitcher_depth_role, (byDepth.get(r.pitcher_depth_role) || 0) + 1);
  }
  console.log(`returner-global pitcher rows: ${rows.length}   to fix: ${fixes.length}   (no rv+, IP-only: ${noRv})`);
  for (const [d, n] of [...byDepth.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d}: ${n} rows   e.g. ${fixes.find((f) => f.depth === d)!.note}`);
  }
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const f of fixes) {
    const { error } = await sb.from("player_predictions").update(f.patch).eq("id", f.id);
    if (error) console.error("err", f.id, error.message);
    else if (++done % 500 === 0) process.stdout.write(`\r  ${done}/${fixes.length}`);
  }
  console.log(`\n✅ cascaded projected_ip → p_war → market on ${done}/${fixes.length} rows (rates/rv+/depth untouched)`);
})();
