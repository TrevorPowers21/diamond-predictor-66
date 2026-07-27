/**
 * Correct stale `class_transition` on prediction rows from the authoritative
 * `players.class_year` (2026 class), matching resolveClassTransition:
 *   non-overridden row + known class_year → classTransitionFromYear(class_year).
 *
 * These defaulted to "SJ" (or null) before class data existed. Safe to fix in
 * place WITHOUT re-running rates: the stored prediction is the dev_agg=0 neutral,
 * where the class adjustment cancels (devScale = 1 at dev_agg=0) — class_transition
 * only scales a coach's dev-agg toggle, so the neutral rates are unchanged.
 *
 * Scope: season 2027, class_transition_overridden = false/null, class_year known
 * & mappable (FR/SO/JR/SR/GR, redshirt-prefixed OK). Rows with no class_year
 * (JUCO/unmatched) are left as-is. Touches ONLY class_transition.
 *
 *   npx tsx scripts/fix-class-transition-from-year.ts            # dry-run (staging)
 *   npx tsx scripts/fix-class-transition-from-year.ts --apply
 *   add --prod for prod (guarded).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { classTransitionFromYear } from "../src/lib/classTransitionUtils";

const PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const ENV = PROD ? ".env.production.local" : ".env.local";
const rd = (k: string) => (fs.readFileSync(ENV, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const url = rd("VITE_SUPABASE_URL") || rd("SUPABASE_URL");
if (PROD && !/trbvxuoliwrfowibatkm/.test(url)) { console.error("--prod but URL not prod. Refusing."); process.exit(1); }
if (!PROD && /trbvxuoliwrfowibatkm/.test(url)) { console.error("no --prod but URL looks prod. Refusing."); process.exit(1); }
const sb = createClient(url, rd("SUPABASE_SERVICE_ROLE_KEY"));

(async () => {
  console.log(`### ${PROD ? "PROD" : "STAGING"}  ${APPLY ? "APPLY" : "DRY-RUN"}  (class_transition ← class_year) ###`);
  const cy = new Map<string, string>();
  let f = 0;
  for (;;) { const { data } = await sb.from("players").select("id, class_year").order("id").range(f, f + 999); for (const p of (data || [])) if (p.class_year) cy.set(p.id, p.class_year); if (!data || data.length < 1000) break; f += 1000; }

  const fixes: { id: string; to: string }[] = [];
  const byPair = new Map<string, number>();
  const byScope = new Map<string, number>();
  let cf = 0;
  for (;;) {
    const { data, error } = await sb.from("player_predictions")
      .select("id, model_type, variant, customer_team_id, player_id, class_transition, class_transition_overridden")
      .eq("season", 2027).order("id").range(cf, cf + 999);
    if (error) throw error;
    for (const r of (data || [])) {
      if (r.class_transition_overridden) continue;
      const yr = cy.get(r.player_id);
      const exp = classTransitionFromYear(yr);
      if (!exp) continue;                       // no/unmappable class_year → leave (JUCO/unmatched)
      if (r.class_transition === exp) continue; // already correct
      fixes.push({ id: r.id, to: exp });
      byPair.set(`${yr}→${exp} (was ${r.class_transition})`, (byPair.get(`${yr}→${exp} (was ${r.class_transition})`) || 0) + 1);
      const scope = `${r.model_type}/${r.variant}/${r.customer_team_id ? "team" : "GLOBAL"}`;
      byScope.set(scope, (byScope.get(scope) || 0) + 1);
    }
    if (!data || data.length < 1000) break;
    cf += 1000;
  }
  console.log(`class_transition to fix: ${fixes.length}`);
  console.log("by scope:"); for (const [s, n] of [...byScope.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
  console.log("by class_year→want (was):"); for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}×  ${k}`);
  if (!APPLY) { console.log("\n(dry-run — no writes. Add --apply.)"); return; }
  let done = 0;
  for (const x of fixes) {
    const { error } = await sb.from("player_predictions").update({ class_transition: x.to }).eq("id", x.id);
    if (error) console.error("err", x.id, error.message);
    else if (++done % 500 === 0) process.stdout.write(`\r  ${done}/${fixes.length}`);
  }
  console.log(`\n✅ updated class_transition on ${done}/${fixes.length} rows (nothing else touched)`);
})();
