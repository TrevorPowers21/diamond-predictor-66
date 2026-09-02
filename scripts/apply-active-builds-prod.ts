/**
 * One-off: set is_active on PROD per Trevor's confirmed picks (2026-07-27).
 * RSTR IQ skipped. BYU pinned to the roster-34 "2027" build (9bb9cc93). Each
 * program → is_active=false on all its builds, then true on the chosen one.
 *   npx tsx scripts/apply-active-builds-prod.ts [--apply]   (env → prod)
 */
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.argv.includes("--apply");

// program keyword → { buildName } or { buildIdPrefix }
const PICKS: { key: string; buildName?: string; buildIdPrefix?: string }[] = [
  { key: "Dallas Baptist", buildName: "DBU 2027" },
  { key: "Vanderbilt", buildName: "Vanderbilt Projected" },
  { key: "BYU", buildIdPrefix: "9bb9cc93" },
  { key: "Penn State", buildIdPrefix: "9df074dc" },
  { key: "Gardner-Webb", buildName: "Gardner Webb Build" },
  { key: "TCU", buildName: "TCU Build" },
  { key: "Stetson", buildName: "Stetson Portal 2026" },
  { key: "Florida Atlantic", buildName: "2027 Default Roster" },
  { key: "Virginia Tech", buildName: "2027 Default Roster" },
  { key: "Arizona State", buildName: "2027 Default Roster" },
];

(async () => {
  const { data: cts } = await sb.from("customer_teams").select("id, name");
  const plan: { ctid: string; program: string; buildId: string; buildName: string }[] = [];
  for (const p of PICKS) {
    const ct = (cts || []).find((c: any) => String(c.name || "").toLowerCase().includes(p.key.toLowerCase()));
    if (!ct) { console.log(`  ⚠ no program matching "${p.key}" — SKIP`); continue; }
    const { data: blds } = await sb.from("team_builds").select("id, name").eq("customer_team_id", ct.id);
    const matches = (blds || []).filter((b: any) =>
      p.buildIdPrefix ? String(b.id).startsWith(p.buildIdPrefix) : String(b.name) === p.buildName);
    if (matches.length !== 1) { console.log(`  ⚠ ${ct.name}: ${matches.length} builds match ${p.buildIdPrefix ?? p.buildName} — SKIP (resolve manually)`); continue; }
    plan.push({ ctid: ct.id, program: ct.name, buildId: matches[0].id, buildName: matches[0].name });
  }
  console.log(`\nPlan (${plan.length} programs; RSTR IQ intentionally excluded):`);
  for (const x of plan) console.log(`  ${x.program} → ${x.buildName} (${x.buildId.slice(0, 8)})`);
  if (!APPLY) { console.log("\nDRY RUN — add --apply."); return; }
  for (const x of plan) {
    await sb.from("team_builds").update({ is_active: false }).eq("customer_team_id", x.ctid);
    const { error } = await sb.from("team_builds").update({ is_active: true }).eq("id", x.buildId);
    if (error) { console.log(`  ❌ ${x.program}: ${error.message}`); throw error; }
  }
  console.log(`\n✅ set active build for ${plan.length} programs`);
})();
