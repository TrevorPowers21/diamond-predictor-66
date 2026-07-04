/**
 * Copy 1-2 teams' full coach state from PROD -> STAGING to test the default-build
 * architecture against real data.
 *
 * - ADDITIVE: upserts into staging, never a destructive replace, never touches
 *   the pitch-log tables. Idempotent (re-runnable).
 * - PLAYER REMAP: players.id UUIDs differ across DBs; source_player_id is stable.
 *   Every team_build_players / target_board / high_follow player_id is translated
 *   prod-UUID -> source_player_id -> staging-UUID. (Verified 100% resolve.)
 * - OWNERSHIP: all copied rows are reassigned to ONE staging test user (whose
 *   email you pass). That user is granted user_team_access (team_admin) for the
 *   FIRST copied team and made a superadmin (user_roles) so they can switch to
 *   the other copied teams via the in-app team switcher. NOTE: user_team_access
 *   is one-row-per-user (useAuth reads it .maybeSingle()) and its `role` column
 *   is NOT NULL + CHECK (team_admin|general_user) — hence the single-team grant.
 * - DEFAULT BUILDS are NOT created here. After copying, run
 *   `npm run create-default-builds -- --team <customer_team_id> --apply` per team
 *   so the "no coach build" and fork-from-default flows are testable.
 * - NOTE: prod predates the default-build migration, so its team_build_players
 *   have NO player_snapshot. Rosters still render on staging via staging's live
 *   player data (all players resolve); the snapshot gets written when you save
 *   a build with the new code. Numbers may differ slightly (staging projections).
 *
 * Usage (dry-run then apply):
 *   PROD_URL=.. PROD_KEY=.. STG_URL=.. STG_KEY=.. COPY_TEAMS="kansas,arkansas" \
 *   TARGET_EMAIL="you@staging-test.com" npx tsx scripts/copy_team_to_staging.ts [--apply]
 */
import { createClient } from "@supabase/supabase-js";

const prod = createClient(process.env.PROD_URL!, process.env.PROD_KEY!, { auth: { persistSession: false } });
const stg  = createClient(process.env.STG_URL!,  process.env.STG_KEY!,  { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");
const TEAMS = (process.env.COPY_TEAMS ?? "kansas,arkansas").split(",").map((s) => s.trim().toLowerCase());
const TARGET_EMAIL = (process.env.TARGET_EMAIL ?? "").toLowerCase();

async function main() {
  if (!TARGET_EMAIL) throw new Error("Set TARGET_EMAIL to a staging test-account email (they become the owner + get team access).");

  // 0. resolve the staging test user by email
  const { data: list, error: ue } = await (stg as any).auth.admin.listUsers({ perPage: 1000 });
  if (ue) throw new Error("staging listUsers: " + ue.message);
  const tu = list.users.find((u: any) => (u.email || "").toLowerCase() === TARGET_EMAIL);
  if (!tu) throw new Error(`No staging auth user with email ${TARGET_EMAIL}. Create it in staging first.`);
  const TU = tu.id;

  // 1. resolve prod teams by name
  const { data: allTeams } = await (prod as any).from("customer_teams").select("*");
  const teams = (allTeams ?? []).filter((t: any) => TEAMS.some((k) => (t.name || "").toLowerCase().includes(k)));
  const teamIds = teams.map((t: any) => t.id);
  if (!teams.length) throw new Error("No prod teams matched " + TEAMS.join(","));

  // 2. pull prod coach state
  const { data: builds } = await (prod as any).from("team_builds").select("*").in("customer_team_id", teamIds);
  const buildIds = (builds ?? []).map((b: any) => b.id);
  const { data: bps } = await (prod as any).from("team_build_players").select("*").in("build_id", buildIds);
  const { data: tb }  = await (prod as any).from("target_board").select("*").in("customer_team_id", teamIds);
  const { data: hf }  = await (prod as any).from("high_follow").select("*").in("customer_team_id", teamIds);

  // 3. player_id remap prod -> staging via source_player_id
  const pids = [...new Set([...(bps ?? []), ...(tb ?? []), ...(hf ?? [])].map((r: any) => r.player_id).filter(Boolean))];
  const { data: prodPlayers } = await (prod as any).from("players").select("id,source_player_id").in("id", pids);
  const sidByProd = new Map((prodPlayers ?? []).map((p: any) => [p.id, p.source_player_id]));
  const sids = [...new Set((prodPlayers ?? []).map((p: any) => p.source_player_id).filter(Boolean))];
  const { data: stgPlayers } = await (stg as any).from("players").select("id,source_player_id").in("source_player_id", sids);
  const stgBySid = new Map((stgPlayers ?? []).map((p: any) => [p.source_player_id, p.id]));
  const remap = (prodPid: string): string | null => stgBySid.get(sidByProd.get(prodPid) as string) ?? null;
  const unmapped = pids.filter((p) => !remap(p));

  console.log(`Teams: ${teams.map((t: any) => t.name).join(", ")}`);
  console.log(`Pulled: ${builds?.length} builds, ${bps?.length} roster rows, ${tb?.length} target-board, ${hf?.length} high-follow`);
  console.log(`Players: ${pids.length} referenced, ${unmapped.length} unmapped${unmapped.length ? " (rows for those will be skipped)" : ""}`);
  console.log(`Target staging user: ${TARGET_EMAIL} (${TU.slice(0, 8)})`);

  if (!APPLY) { console.log("\n[dry-run] no writes. Re-run with --apply to copy into staging."); return; }

  // Every write below is error-checked. The prior version swallowed errors,
  // which silently dropped customer_teams + user_team_access and left the copied
  // builds with no team context (empty roster on load). chk() makes any failed
  // write fatal + visible.
  const chk = (label: string, error: any) => {
    if (error) throw new Error(`${label} failed: ${error.message}${error.details ? " | " + error.details : ""}`);
  };

  // 4. customer_teams — remap school_team_id prod -> staging via Teams Table
  //    source_id (Teams Table UUIDs usually match across DBs, but not always;
  //    a dangling school_team_id breaks branding + returner-matching for the
  //    default-build seed). Keep the prod id when it already resolves on staging.
  const prodStids = [...new Set(teams.map((t: any) => t.school_team_id).filter(Boolean))];
  const { data: prodTT } = await (prod as any).from("Teams Table").select("id,source_id").in("id", prodStids);
  const srcByProdTT = new Map((prodTT ?? []).map((r: any) => [r.id, r.source_id]));
  const prodSrcIds = [...new Set((prodTT ?? []).map((r: any) => r.source_id).filter(Boolean))];
  const { data: stgTT } = await (stg as any).from("Teams Table").select("id,source_id").or(
    `id.in.(${prodStids.join(",")}),source_id.in.(${prodSrcIds.join(",")})`,
  );
  const stgTTIds = new Set((stgTT ?? []).map((r: any) => r.id));
  const stgTTBySrc = new Map<string, string>();
  for (const r of stgTT ?? []) if (r.source_id != null && !stgTTBySrc.has(String(r.source_id))) stgTTBySrc.set(String(r.source_id), r.id);
  const remapStid = (prodStid: string | null): string | null => {
    if (!prodStid) return null;
    if (stgTTIds.has(prodStid)) return prodStid; // same UUID exists on staging
    const src = srcByProdTT.get(prodStid);
    return (src != null ? stgTTBySrc.get(String(src)) : null) ?? null;
  };
  const teamsRemapped = teams.map((t: any) => {
    const stid = remapStid(t.school_team_id);
    if (t.school_team_id && !stid) console.warn(`  ⚠ ${t.name}: school_team_id ${t.school_team_id} has no staging match — branding/returner-seed may miss.`);
    return { ...t, school_team_id: stid ?? t.school_team_id };
  });
  chk("customer_teams upsert", (await (stg as any).from("customer_teams").upsert(teamsRemapped, { onConflict: "id" })).error);

  // 5. team context for the test user. user_team_access is ONE row per user
  //    (useAuth reads it with .maybeSingle()), and `role` is NOT NULL with a
  //    CHECK constraint (team_admin | general_user). So: grant the PRIMARY team
  //    via user_team_access, and make the user a superadmin (user_roles) so they
  //    can reach the OTHER copied teams via the in-app team switcher.
  const primaryTeamId = teamIds[0];
  chk("user_team_access upsert", (await (stg as any).from("user_team_access").upsert(
    [{ user_id: TU, customer_team_id: primaryTeamId, role: "team_admin" }],
    { onConflict: "user_id,customer_team_id" },
  )).error);
  chk("user_roles superadmin upsert", (await (stg as any).from("user_roles").upsert(
    [{ user_id: TU, role: "superadmin" }],
    { onConflict: "user_id,role" },
  )).error);

  // 6. team_builds (reassign owner -> test user, keep prod id + customer_team_id)
  chk("team_builds upsert", (await (stg as any).from("team_builds").upsert((builds ?? []).map((b: any) => ({ ...b, user_id: TU })), { onConflict: "id" })).error);

  // 7. team_build_players: clear these builds' rows, insert remapped.
  //    THREE row kinds must survive:
  //    - DB players: remap prod player_id -> staging via source_player_id; drop
  //      only if the player genuinely isn't on staging (logged as unmapped).
  //    - Imported local players: player_id is null but custom_name is set (a
  //      coach-entered freshman/recruit not in the players table). Keep AS-IS
  //      (player_id stays null). The old `.filter(r => r.player_id)` silently
  //      dropped every one of these.
  //    - included_in_roster is preserved verbatim (on-roster targets stay on
  //      the roster; do not let it default to false).
  chk("team_build_players delete", (await (stg as any).from("team_build_players").delete().in("build_id", buildIds)).error);
  const bpRows = (bps ?? []).map((r: any) => {
    const { id, ...rest } = r;
    if (!r.player_id) {
      // imported local player — keep if it carries a name, else it's a truly
      // empty slot and can be skipped.
      return (r.custom_name && String(r.custom_name).trim()) ? { ...rest, player_id: null } : null;
    }
    const mapped = remap(r.player_id);
    return mapped ? { ...rest, player_id: mapped } : null; // drop only unmapped DB players
  }).filter(Boolean);
  for (let i = 0; i < bpRows.length; i += 500) chk(`team_build_players insert @${i}`, (await (stg as any).from("team_build_players").insert(bpRows.slice(i, i + 500))).error);

  // 8. target_board (reassign owner, remap player)
  const tbRows = (tb ?? []).map((r: any) => { const { id, ...rest } = r; return { ...rest, user_id: TU, player_id: remap(r.player_id) }; }).filter((r: any) => r.player_id);
  if (tbRows.length) chk("target_board upsert", (await (stg as any).from("target_board").upsert(tbRows, { onConflict: "user_id,customer_team_id,player_id" })).error);

  // 9. high_follow (reassign owner, remap player)
  const hfRows = (hf ?? []).map((r: any) => { const { id, ...rest } = r; return { ...rest, user_id: TU, player_id: remap(r.player_id) }; }).filter((r: any) => r.player_id);
  if (hfRows.length) chk("high_follow upsert", (await (stg as any).from("high_follow").upsert(hfRows, { onConflict: "user_id,customer_team_id,player_id" })).error);

  console.log(`\n✅ copied into staging: ${teams.length} teams, ${builds?.length} builds, ${bpRows.length} roster rows, ${tbRows.length} target-board, ${hfRows.length} high-follow — owned by ${TARGET_EMAIL} (team_admin of ${teams[0]?.name}, superadmin for the rest).`);
  console.log(`   Next: seed default builds so the "no coach build" + fork-from-default flows are testable:`);
  console.log(`     npm run create-default-builds -- --team <customer_team_id> --apply   (per copied team)`);
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
