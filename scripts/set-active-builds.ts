/**
 * One-time: set team_builds.is_active for programs that never got a flag (legacy
 * builds pre-date the mark-active-on-create logic). Uses the shared resolver
 * (same-team → current-year → largest roster → most-recent) so the choice matches
 * the app. Programs that ALREADY have an is_active build are left untouched.
 *
 *   npx tsx scripts/set-active-builds.ts          # dry run
 *   npx tsx scripts/set-active-builds.ts --apply  # write
 */
import { createClient } from "@supabase/supabase-js";
import { resolveActiveBuildId } from "../src/lib/activeBuild";
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: cts } = await sb.from("customer_teams").select("id, name");
  const { data: builds } = await sb.from("team_builds").select("id, name, customer_team_id, is_active, is_default, team, academic_year, updated_at, created_at");
  // roster counts per build (largest-roster tiebreak)
  const counts = new Map<string, number>();
  for (const b of (builds || [])) { const { count } = await sb.from("team_build_players").select("*", { count: "exact", head: true }).eq("build_id", b.id).eq("included_in_roster", true); counts.set(b.id, count ?? 0); }

  const byCt = new Map<string, any[]>();
  for (const b of (builds || [])) { (byCt.get(b.customer_team_id) ?? byCt.set(b.customer_team_id, []).get(b.customer_team_id)!).push({ ...b, roster_count: counts.get(b.id) ?? 0 }); }

  const plan: { ctid: string; name: string; chosen: string; chosenName: string; clears: string[] }[] = [];
  for (const [ctid, bs] of byCt) {
    if (bs.some((b) => b.is_active)) continue; // already flagged — leave it
    const programTeam = bs[0]?.team ?? null;
    const chosen = resolveActiveBuildId(bs, { programTeam });
    if (!chosen) continue;
    const chosenB = bs.find((b) => b.id === chosen);
    plan.push({ ctid, name: (cts || []).find((c: any) => c.id === ctid)?.name ?? ctid.slice(0, 8), chosen, chosenName: `${chosenB?.name} (roster ${chosenB?.roster_count}, ${chosenB?.academic_year})`, clears: bs.filter((b) => b.id !== chosen && b.is_active).map((b) => b.id) });
  }
  console.log(`programs needing an active build: ${plan.length}`);
  for (const p of plan) console.log(`  ${p.name}: → ${p.chosenName}`);
  if (!APPLY) { console.log("\nDRY RUN — add --apply."); return; }
  for (const p of plan) {
    await sb.from("team_builds").update({ is_active: false }).eq("customer_team_id", p.ctid); // exactly one active
    const { error } = await sb.from("team_builds").update({ is_active: true }).eq("id", p.chosen);
    if (error) throw error;
  }
  console.log(`✅ set active build for ${plan.length} programs`);
})();
