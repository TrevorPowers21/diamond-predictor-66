/**
 * Round non-integer p_wrc_plus to whole + recompute o_war (whole-wRC+ convention,
 * commit 0f8299d). Deterministic; matches the logged staging op ("wRC+ rounded to
 * whole + o_war recomputed"). Touches ONLY p_wrc_plus + o_war (hitter market is
 * refreshed afterward by fix-prediction-war-market.ts off the new o_war).
 *
 *   npx tsx scripts/fix-wrc-round.ts [--apply] [--prod]
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { computeHitterOWar } from "../src/lib/depthRoles";

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
  console.log(`### ${PROD ? "PROD" : "STAGING"}  ${APPLY ? "APPLY" : "DRY-RUN"}  (wRC+ round + o_war) ###`);
  const fixes: { id: string; wrc: number; owar: number | null }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, p_wrc_plus, o_war, hitter_depth_role")
      .eq("season", 2027).not("p_wrc_plus", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of (data || [])) {
      const w = Number(r.p_wrc_plus);
      if (Number.isInteger(w)) continue;
      const rw = Math.round(w);
      const owar = r.hitter_depth_role && n(r.o_war) != null ? computeHitterOWar(rw, null, r.hitter_depth_role as any) : n(r.o_war);
      fixes.push({ id: r.id, wrc: rw, owar });
    }
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  console.log(`non-integer wRC+ rows to round: ${fixes.length}`);
  fixes.slice(0, 6).forEach((f) => console.log(`  wRC+→${f.wrc}, oWAR→${f.owar?.toFixed(4)}`));
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const f of fixes) {
    const patch: any = { p_wrc_plus: f.wrc };
    if (f.owar != null) patch.o_war = f.owar;
    const { error } = await sb.from("player_predictions").update(patch).eq("id", f.id);
    if (error) console.error("err", f.id, error.message);
    else if (++done % 500 === 0) process.stdout.write(`\r  ${done}/${fixes.length}`);
  }
  console.log(`\n✅ rounded wRC+ + recomputed o_war on ${done}/${fixes.length} rows`);
})();
