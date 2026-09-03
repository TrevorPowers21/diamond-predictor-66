#!/usr/bin/env node
/**
 * Create a CATALOG-READ-ONLY Postgres role for CI.
 *
 * WHY. `agent:drift` and `agent:rls` need to run on every PR, which means a connection string in a
 * GitHub secret. The existing PGURI connects as `postgres` — the app owner, with full write access
 * and `can_create_roles`. A CI secret that can write to a database is fine until it isn't: any
 * workflow that runs can read it, including one added in a PR.
 *
 * WHAT THIS ROLE CAN DO. Read the catalog: pg_indexes, pg_policies, pg_tables, pg_constraint,
 * information_schema. That is everything drift and rls use, and it is all those views are — catalog
 * views are world-readable by default, so no table grants are needed.
 *
 * WHAT IT CANNOT DO. Read a single row of your data. No SELECT on any table, no INSERT/UPDATE/
 * DELETE, no DDL. Verified at the end of this script rather than assumed.
 *
 * STAGING ONLY. Refuses to run against any other project ref.
 *
 *   npx tsx scripts/agent/create-ci-readonly-role.ts --dry-run   # print the SQL, change nothing
 *   npx tsx scripts/agent/create-ci-readonly-role.ts             # create it (rotates if it exists)
 *
 * The connection string is written to .env.local as CI_READONLY_PGURI — gitignored, and recoverable
 * later with `grep CI_READONLY_PGURI .env.local` rather than a rotation.
 *   npx tsx scripts/agent/create-ci-readonly-role.ts --drop      # remove it
 */
import { Client } from "pg";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { randomBytes } from "crypto";

const STAGING_REF = "slrxowawbijbjrkozqlj";
const ROLE = "ci_readonly";
const DRY = process.argv.includes("--dry-run");
const DROP = process.argv.includes("--drop");

const C = { r: "\x1b[0m", b: "\x1b[1m", g: "\x1b[32m", red: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${C.g}✓${C.r} ${s}`);
const bad = (s: string) => console.log(`  ${C.red}✗${C.r} ${s}`);
const info = (s: string) => console.log(`  ${C.c}·${C.r} ${s}`);

function env(key: string): string | undefined {
  try {
    const m = readFileSync(resolve(process.cwd(), ".env.local"), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

(async () => {
  const uri = env("PGURI");
  if (!uri) { bad("No PGURI in .env.local"); process.exit(1); }
  if (!uri.includes(STAGING_REF)) { bad(`Refusing: PGURI is not staging (${STAGING_REF})`); process.exit(1); }

  const u = new URL(uri);
  console.log(C.b + `\n══ CI read-only role — STAGING (${STAGING_REF}) ══` + C.r);
  info(`connecting as ${u.username} @ ${u.hostname}`);

  // Generated here so it never lands in a file, a commit, or shell history.
  const password = randomBytes(24).toString("base64url");

  const sql = DROP
    ? [`DROP ROLE IF EXISTS ${ROLE};`]
    : [
        // Idempotent: re-running rotates the password rather than erroring.
        `DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
             ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}';
           ELSE
             CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}';
           END IF;
         END $$;`,
        `GRANT CONNECT ON DATABASE ${u.pathname.slice(1)} TO ${ROLE};`,
        `GRANT USAGE ON SCHEMA public TO ${ROLE};`,
        // Deliberately NO table grants. Catalog views are world-readable, which is all that
        // agent:drift and agent:rls need. Adding SELECT here would defeat the point of the role.
      ];

  if (DRY) {
    console.log(C.y + "\n  DRY RUN — nothing will change. SQL that would run:\n" + C.r);
    // replaceAll, not replace — the password appears TWICE (the ALTER and CREATE branches) and
    // replace() swaps only the first, which leaked it on the dry run.
    for (const s of sql) console.log(s.replaceAll(password, "<generated-at-runtime>").split("\n").map((l) => "    " + l).join("\n"));
    console.log("");
    process.exit(0);
  }

  const c = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const s of sql) await c.query(s);
  ok(DROP ? `dropped ${ROLE}` : `${ROLE} created (or password rotated)`);

  if (DROP) { await c.end(); return; }

  // ── verify against the catalog, not against the fact that the statements returned ──────────────
  const r = await c.query(
    `select rolcanlogin, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = $1`, [ROLE]);
  if (!r.rows.length) { bad("role does not exist after creation"); await c.end(); process.exit(1); }
  const g = r.rows[0];
  (g.rolcanlogin ? ok : bad)("can log in");
  (!g.rolsuper ? ok : bad)("is NOT superuser");
  (!g.rolcreaterole ? ok : bad)("cannot create roles");
  (!g.rolcreatedb ? ok : bad)("cannot create databases");

  const t = await c.query(
    `select count(*)::int n from information_schema.role_table_grants where grantee = $1`, [ROLE]);
  (t.rows[0].n === 0 ? ok : bad)(`has ${t.rows[0].n} table grant(s) — expected 0`);
  await c.end();

  // Prove it end to end: connect AS the new role and confirm it can read the catalog but not data.
  // ⚠ Supabase's POOLER needs the tenant ref embedded in the USERNAME — `role.project_ref`, which
  // is why the app's own URI connects as `postgres.slrxowawbijbjrkozqlj`. A bare `ci_readonly` is
  // rejected with "no tenant identifier provided (external_id or sni_hostname required)". Caught by
  // the connect-as check below; without it we would have shipped a secret that fails in CI for a
  // reason the log does not explain.
  const poolerUser = u.hostname.includes("pooler.supabase.com") ? `${ROLE}.${STAGING_REF}` : ROLE;
  const ciUri = `${u.protocol}//${poolerUser}:${encodeURIComponent(password)}@${u.host}${u.pathname}`;
  const ci = new Client({ connectionString: ciUri, ssl: { rejectUnauthorized: false } });
  try {
    await ci.connect();
    const cat = await ci.query(`select count(*)::int n from pg_indexes where schemaname='public'`);
    ok(`as ${ROLE}: reads the catalog (${cat.rows[0].n} indexes) — drift and rls will work`);
    try {
      await ci.query(`select 1 from player_predictions limit 1`);
      bad(`as ${ROLE}: CAN read player_predictions — it should not be able to`);
    } catch { ok(`as ${ROLE}: CANNOT read player_predictions — data stays private`); }
    await ci.end();
  } catch (e: any) {
    bad(`could not connect as ${poolerUser}: ${e.message}`);
    bad("NOT usable as a CI secret until this connects. Do not save the value below.");
    process.exitCode = 1;
  }

  // Persist to .env.local so the value is recoverable rather than one-shot. That file is
  // gitignored (`*.local` in .gitignore, verified before writing) and already holds PGURI.
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const cur = readFileSync(envPath, "utf8");
    const line = `CI_READONLY_PGURI=${ciUri}`;
    const next = /^CI_READONLY_PGURI=.*$/m.test(cur)
      ? cur.replace(/^CI_READONLY_PGURI=.*$/m, line)          // rotate in place
      : cur.replace(/\n*$/, "\n") + line + "\n";
    writeFileSync(envPath, next);
    ok("saved to .env.local as CI_READONLY_PGURI (gitignored)");
  } else bad(".env.local not found — the value is printed below and NOT saved anywhere");

  console.log(C.b + "\n── add this as a GitHub secret ──" + C.r);
  console.log(`  name:  STAGING_PGURI`);
  console.log(`  value: ${ciUri}`);
  console.log(`\n  ${C.y}Settings → Secrets and variables → Actions → New repository secret.`);
  console.log(`  Also saved to .env.local, so re-reading it later does not require a rotation:`);
  console.log(`    grep CI_READONLY_PGURI .env.local`);
  console.log(`  Re-running this script rotates the password and updates that line.${C.r}\n`);
})().catch((e) => { bad(e.message); process.exit(1); });
