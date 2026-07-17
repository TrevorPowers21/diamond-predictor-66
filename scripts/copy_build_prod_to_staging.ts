/**
 * Copy one saved Team-Builder build from PROD → STAGING, remapping player_ids
 * via the stable source_player_id (the two DBs have different UUIDs). Prod is
 * READ-ONLY; only staging is written. Dry-run by default; --write to persist.
 *   npx tsx scripts/copy_build_prod_to_staging.ts <prodBuildId> [--write]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
function envOf(file: string) {
  const t = readFileSync(file, "utf8");
  const url = t.match(/VITE_SUPABASE_URL=(\S+)/)?.[1];
  const key = t.match(/SUPABASE_SERVICE_ROLE_KEY=(\S+)/)?.[1];
  return createClient(url!, key!, { auth: { persistSession: false } }) as any;
}
const PROD = envOf(".env.production.local");
const STG = envOf(".env.local");
const BUILD = process.argv[2];
const WRITE = process.argv.includes("--write");

async function main() {
  const { data: b } = await PROD.from("team_builds").select("*").eq("id", BUILD).single();
  console.log(`Build: "${b.name}" team=${b.team} yr=${b.academic_year} budget=${b.total_budget}`);
  const { data: bps } = await PROD.from("team_build_players").select("*").eq("build_id", BUILD);
  const pids = bps.filter((r: any) => r.player_id).map((r: any) => r.player_id);
  const { data: pp } = await PROD.from("players").select("id, source_player_id").in("id", pids);
  const prodToSrc = new Map(pp.map((p: any) => [p.id, String(p.source_player_id)]));
  const srcs = [...prodToSrc.values()];
  const { data: sp } = await STG.from("players").select("id, source_player_id").in("source_player_id", srcs);
  const srcToStg = new Map((sp || []).map((p: any) => [String(p.source_player_id), p.id]));
  // prod player_id → staging player_id
  const idMap = new Map<string, string>();
  let unmapped = 0;
  for (const [pid, src] of prodToSrc) { const s = srcToStg.get(src); if (s) idMap.set(pid, s); else unmapped++; }
  console.log(`Players: ${bps.length} | mapped ${idMap.size} | UNMAPPED ${unmapped}`);
  // staging Georgia customer team
  const { data: gt } = await STG.from("customer_teams").select("id,name").ilike("name", `%${b.team}%`);
  const stgTeam = gt?.[0];
  console.log(`Staging customer team for "${b.team}": ${stgTeam ? `${stgTeam.name} (${stgTeam.id})` : "NONE — cannot attach"}`);
  if (unmapped > 0 || !stgTeam) { console.log("\n⚠ blockers above — not writing."); return; }
  // remap depth JSON player-ids by string substitution
  const remapJson = (v: any) => { if (v == null) return v; let s = JSON.stringify(v); for (const [p, st] of idMap) s = s.split(p).join(st); return JSON.parse(s); };
  if (!WRITE) { console.log("\nDRY RUN — re-run with --write. Would create the build + " + bps.length + " players on staging."); return; }

  const { data: nb, error } = await STG.from("team_builds").insert({
    user_id: b.user_id, name: b.name, team: b.team, season: b.season, total_budget: b.total_budget, notes: b.notes,
    customer_team_id: stgTeam.id, depth_assignments: remapJson(b.depth_assignments), depth_placeholders: remapJson(b.depth_placeholders),
    is_default: false, academic_year: b.academic_year,
  }).select("id").single();
  if (error) { console.error("build insert failed:", error.message); return; }
  const rows = bps.map((r: any) => ({
    build_id: nb.id, player_id: idMap.get(r.player_id), source: r.source, custom_name: r.custom_name,
    position_slot: r.position_slot, depth_order: r.depth_order, nil_value: r.nil_value, production_notes: r.production_notes,
    player_snapshot: r.player_snapshot, included_in_roster: r.included_in_roster,
  }));
  const { error: e2 } = await STG.from("team_build_players").insert(rows);
  if (e2) { console.error("players insert failed:", e2.message); return; }
  // make it the live build for the demo (one active per team)
  await STG.from("team_builds").update({ is_active: false }).eq("customer_team_id", stgTeam.id);
  await STG.from("team_builds").update({ is_active: true }).eq("id", nb.id);
  console.log(`✓ Created staging build ${nb.id} with ${rows.length} players, set ACTIVE.`);
}
main();
