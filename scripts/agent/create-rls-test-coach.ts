#!/usr/bin/env node
/**
 * Create (or remove) a NON-SUPERADMIN test coach on STAGING, then prove the RLS boundary with it.
 *
 * WHY THIS EXISTS
 *   Staging has exactly ONE login and it is a superadmin, so the coach experience — the one 51 real
 *   prod users have — cannot be tested at all. Worse, a superadmin looks like a passing test:
 *   they satisfy `has_role(superadmin)` and the pre-existing `Staff can manage` ALL policy, and
 *   permissive policies are OR'd, so RLS never denies them anything. Impersonation does not help
 *   either — it changes effectiveTeamId in the app, but RLS still evaluates has_role() against the
 *   real uid.
 *
 *   The test user therefore gets NO row in user_roles. That absence is the entire point: it makes
 *   them depend solely on the team-scoped policy, exactly like a real coach.
 *
 * STAGING ONLY. Refuses to run against any other project ref.
 *
 *   npx tsx scripts/agent/create-rls-test-coach.ts            # create + verify
 *   npx tsx scripts/agent/create-rls-test-coach.ts --cleanup   # remove the user
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Client, types } from "pg";
import { randomBytes } from "node:crypto";

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

const STAGING_REF = "slrxowawbijbjrkozqlj";
const EMAIL = "rls-test-coach@rstriq.test";
const CLEANUP = process.argv.includes("--cleanup");

const C = { r: "\x1b[0m", b: "\x1b[1m", g: "\x1b[32m", red: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${C.g}✓${C.r} ${s}`);
const bad = (s: string) => console.log(`  ${C.red}✗${C.r} ${s}`);
const info = (s: string) => console.log(`  ${C.c}·${C.r} ${s}`);

function loadEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

async function main() {
  const env = loadEnv(join(process.cwd(), ".env.local"));
  const url = env.SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const pg = env.PGURI ?? "";

  // Hard guard — same pattern as scripts/mirror-prod-auth-user.ts.
  if (!url.includes(STAGING_REF)) { bad(`Refusing to run: SUPABASE_URL is not staging (${STAGING_REF})`); process.exit(1); }
  if (!pg) { bad("No PGURI in .env.local"); process.exit(1); }

  console.log(C.b + `\n══ RLS test coach — STAGING (${STAGING_REF}) ══` + C.r);

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const db = new Client({ connectionString: pg, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const existing = (await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users
    .find((u) => u.email === EMAIL);

  // ── cleanup ────────────────────────────────────────────────────────────────
  if (CLEANUP) {
    if (!existing) { info("nothing to remove"); await db.end(); return; }
    await db.query(`delete from user_team_access where user_id = $1`, [existing.id]);
    await sb.auth.admin.deleteUser(existing.id);
    ok(`removed ${EMAIL}`);
    await db.end();
    return;
  }

  // ── create ─────────────────────────────────────────────────────────────────
  const team = (await db.query(
    `select ct.id, ct.name from customer_teams ct
     where exists (select 1 from player_predictions p where p.customer_team_id = ct.id)
     order by ct.name limit 1`)).rows[0];
  const otherTeam = (await db.query(
    `select ct.id, ct.name from customer_teams ct
     where ct.id <> $1 and exists (select 1 from player_predictions p where p.customer_team_id = ct.id)
     order by ct.name limit 1`, [team.id])).rows[0];

  let userId: string;
  let password = "";
  if (existing) {
    userId = existing.id;
    // Always reset the password on re-run: an existing account whose password nobody has is
    // useless for the click-through half of the test.
    password = `Rls-${randomBytes(9).toString("base64url")}!`;
    const { error } = await sb.auth.admin.updateUserById(userId, { password });
    if (error) { bad(`password reset: ${error.message}`); password = ""; }
    else info(`${EMAIL} already existed — reused (${userId}), password reset`);
  } else {
    password = `Rls-${randomBytes(9).toString("base64url")}!`;
    const { data, error } = await sb.auth.admin.createUser({
      email: EMAIL, password, email_confirm: true,
      user_metadata: { note: "RLS boundary test account — non-superadmin coach. Safe to delete." },
    });
    if (error) { bad(`createUser: ${error.message}`); await db.end(); process.exit(1); }
    userId = data.user!.id;
    ok(`created auth user ${userId}`);
  }

  await db.query(
    // PK is COMPOSITE (user_id, customer_team_id) — a user may hold access to several teams.
    `insert into user_team_access (user_id, customer_team_id, role) values ($1,$2,'general_user')
     on conflict (user_id, customer_team_id) do update set role = excluded.role`,
    [userId, team.id]);
  ok(`granted general_user access to ${team.name}`);

  // The absence of a user_roles row is what makes this a valid test.
  const roles = await db.query(`select role from user_roles where user_id = $1`, [userId]);
  if (roles.rows.length) {
    bad(`user has roles [${roles.rows.map((r) => r.role).join(",")}] — NOT a valid coach test. Remove them.`);
    await db.end(); process.exit(1);
  }
  ok("no user_roles row — depends solely on the team-scoped policy, like a real coach");

  // ── prove the boundary as this user ────────────────────────────────────────
  console.log(C.b + "\n── RLS boundary, queried AS this user ──" + C.r);
  const service = (await db.query(
    `select (select count(*)::int from player_predictions where customer_team_id=$1) own,
            (select count(*)::int from player_predictions where customer_team_id=$2) other,
            (select count(*)::int from player_predictions where customer_team_id is null) global`,
    [team.id, otherTeam.id])).rows[0];
  info(`service role (RLS bypassed): own=${service.own} other=${service.other} global=${service.global}`);

  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: "authenticated" })]);
  const asUser = (await db.query(
    `select (select count(*)::int from player_predictions where customer_team_id=$1) own,
            (select count(*)::int from player_predictions where customer_team_id=$2) other,
            (select count(*)::int from player_predictions where customer_team_id is null) global`,
    [team.id, otherTeam.id])).rows[0];
  await db.query("rollback");
  info(`as the coach:                own=${asUser.own} other=${asUser.other} global=${asUser.global}`);

  console.log("");
  const a = asUser.own === service.own;
  const b = asUser.other === 0;
  const c = asUser.global === service.global;
  (a ? ok : bad)(`own team (${team.name}) visible: ${asUser.own}/${service.own}`);
  (b ? ok : bad)(`other team (${otherTeam.name}) blocked: ${service.other} → ${asUser.other}`);
  (c ? ok : bad)(`global reference rows readable: ${asUser.global}`);

  if (password) {
    console.log(C.b + "\n── credentials (staging only) ──" + C.r);
    console.log(`  email:    ${EMAIL}`);
    console.log(`  password: ${password}`);
    console.log(`  ${C.y}Log in on staging and click through Team Builder / Target Board / Returning`);
    console.log(`  Players. That is the coach experience staging could not test before.${C.r}`);
  }

  await db.end();
  process.exit(a && b && c ? 0 : 1);
}

main().catch((e) => { console.error("✖", e.message); process.exit(1); });
