/**
 * RLS LIVING ANALYSIS — rstr-agent-plan.md §10 step 2, and §4's DB-safety hard stop:
 *
 *   "RLS is part of everything. Maintain a saved, living analysis of how RLS works (per table +
 *    actor: what each policy allows) so correctness is provable, not assumed."
 *
 * Every check here traces to a real failure:
 *   - remove-access silently deleted 0 rows because RLS blocked the write and returned no error
 *   - a Supabase write filtered by RLS returns SUCCESS with 0 rows affected
 *   - self-referencing policies recurse unless they go through a SECURITY DEFINER helper
 *
 * READ-ONLY. Schema introspection only — this never reads row data and never writes.
 *
 *   npx tsx scripts/agent/rls-analysis.ts [--prod] [--md]
 *
 * Defaults to STAGING. Pass --prod deliberately.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Client, types } from "pg";

types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);

const PROD = process.argv.includes("--prod");
const MD = process.argv.includes("--md");
const ENV_FILE = PROD ? ".env.production.local" : ".env.local";

function readEnv(file: string, key: string): string | undefined {
  try {
    const m = readFileSync(resolve(process.cwd(), file), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

const CONN = readEnv(ENV_FILE, "PGURI") || readEnv(ENV_FILE, "DATABASE_URL");
if (!CONN) { console.error(`✖ No PGURI/DATABASE_URL in ${ENV_FILE}`); process.exit(1); }

/** The write verbs. A table with a SELECT policy and no INSERT/UPDATE/DELETE policy is read-only
 *  to that actor — which is fine when intended and a silent 0-row failure when it is not. */
const WRITES = ["INSERT", "UPDATE", "DELETE"] as const;

(async () => {
  const c = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const tables = (await c.query(`
    select c.relname as table, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
           coalesce(s.n_live_tup, 0)::bigint as est_rows
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relname = c.relname and s.schemaname = 'public'
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`)).rows;

  const policies = (await c.query(`
    select tablename as table, policyname as name, permissive, roles, cmd,
           qual as using_expr, with_check as check_expr
    from pg_policies where schemaname = 'public'
    order by tablename, policyname`)).rows;

  const byTable = new Map<string, any[]>();
  for (const p of policies) {
    const a = byTable.get(p.table) ?? [];
    a.push(p);
    byTable.set(p.table, a);
  }

  const out: string[] = [];
  const P = (s = "") => { out.push(s); console.log(s); };
  const H = (s: string) => P(MD ? `\n## ${s}\n` : `\n══ ${s}`);

  P(MD ? "# RLS Living Analysis\n" : "RLS LIVING ANALYSIS");
  P(`database: ${PROD ? "PROD" : "STAGING"} · ${tables.length} tables · ${policies.length} policies`);
  P("⚠ Read-only schema introspection. Proves what policies EXIST, not that they are correct.");

  // ── 1. RLS off entirely ────────────────────────────────────────────────────
  const noRls = tables.filter((t) => !t.rls_enabled);
  H(`RLS DISABLED (${noRls.length})`);
  if (!noRls.length) P("  none — every public table has RLS enabled");
  else {
    P("  Any authenticated client can read/write these in full. Intentional for lookup tables;");
    P("  a hole for anything program-scoped.\n");
    for (const t of noRls) P(`  ${t.table.padEnd(44)} ~${Number(t.est_rows).toLocaleString()} rows`);
  }

  // ── 2. RLS on, but no policy = deny-all ────────────────────────────────────
  const rlsNoPolicy = tables.filter((t) => t.rls_enabled && !byTable.has(t.table));
  H(`RLS ON WITH NO POLICY — deny-all (${rlsNoPolicy.length})`);
  if (!rlsNoPolicy.length) P("  none");
  else {
    P("  RLS enabled and zero policies means NOBODY can read or write via the anon/authenticated");
    P("  role. Service-role bypasses it, so a script works and the app silently sees nothing.\n");
    for (const t of rlsNoPolicy) P(`  ${t.table.padEnd(44)} ~${Number(t.est_rows).toLocaleString()} rows`);
  }

  // ── 3. write-path coverage ─────────────────────────────────────────────────
  H("WRITE-PATH COVERAGE — readable but not writable");
  P("  The failure this catches: an RLS-blocked write returns SUCCESS with 0 rows affected and no");
  P("  error. Remove-access silently deleted 0 rows exactly this way.\n");
  const readOnly: string[] = [];
  for (const [table, ps] of byTable) {
    const cmds = new Set(ps.map((p) => p.cmd));
    const hasRead = cmds.has("SELECT") || cmds.has("ALL");
    const hasWrite = cmds.has("ALL") || WRITES.some((w) => cmds.has(w));
    if (hasRead && !hasWrite) readOnly.push(table);
  }
  if (!readOnly.length) P("  none");
  else for (const t of readOnly) {
    const cmds = [...new Set(byTable.get(t)!.map((p) => p.cmd))].join(", ");
    P(`  ${t.padEnd(44)} policies for: ${cmds}`);
  }

  // ── 4. self-reference without a SECURITY DEFINER helper ────────────────────
  H("SELF-REFERENCING POLICIES — recursion risk");
  P("  A policy on table X whose USING clause selects from X recurses unless it goes through a");
  P("  SECURITY DEFINER function.\n");
  const selfRef = policies.filter((p) => {
    const expr = `${p.using_expr ?? ""} ${p.check_expr ?? ""}`;
    return new RegExp(`\\b(from|join)\\s+"?${p.table}"?\\b`, "i").test(expr);
  });
  if (!selfRef.length) P("  none");
  else for (const p of selfRef) P(`  ${p.table}  ${p.name}\n      ${(p.using_expr ?? "").slice(0, 160)}`);

  // ── 5. the program-scoping spine ───────────────────────────────────────────
  H("PROGRAM SCOPING — customer_team_id");
  P("  Program-scoped data must key off customer_team_id. A table that HAS the column but whose");
  P("  policies never mention it is scoped by convention only.\n");
  // ⚠ pg_attribute, NOT information_schema.columns. information_schema is PRIVILEGE-FILTERED — it
  // only lists objects the connected role has rights on, so a least-privilege CI role would see an
  // EMPTY result here and this section would print as clean while checking nothing. An empty result
  // looks exactly like "nothing is wrong". pg_catalog is not filtered.
  const hasCol = (await c.query(`
    select c.relname as table_name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attname = 'customer_team_id' and a.attnum > 0 and not a.attisdropped
    order by 1`)).rows.map((r) => r.table_name);
  for (const t of hasCol) {
    const ps = byTable.get(t) ?? [];
    const mentions = ps.some((p) => `${p.using_expr ?? ""} ${p.check_expr ?? ""}`.includes("customer_team_id"));
    const mark = !ps.length ? "⚠ NO POLICY" : mentions ? "✅ scoped" : "⚠ policies ignore it";
    P(`  ${t.padEnd(44)} ${mark}`);
  }

  // ── 6. per-table x actor matrix ────────────────────────────────────────────
  H("PER-TABLE POLICY MATRIX");
  P("  cmd → the roles the policy applies to. `{public}` means every role.\n");
  for (const t of tables.filter((x) => byTable.has(x.table))) {
    const ps = byTable.get(t.table)!;
    P(`  ${t.table}`);
    for (const p of ps) {
      const roles = Array.isArray(p.roles) ? p.roles.join(",") : String(p.roles);
      P(`      ${String(p.cmd).padEnd(7)} ${p.permissive === "PERMISSIVE" ? "     " : "RESTR"} ${roles.padEnd(16)} ${p.name}`);
    }
  }

  H("WHAT THIS DOES NOT PROVE");
  P("  Policies EXIST — not that they are correct. It does not execute a query as each actor, so it");
  P("  cannot show that a coach is actually prevented from reading another program's rows. That");
  P("  needs real sessions per role. Treat a clean run as 'no structural hole', never 'RLS is right'.");

  await c.end();

  if (MD) {
    const path = resolve(process.cwd(), "docs/RLS_ANALYSIS.md");
    writeFileSync(path, out.join("\n") + "\n");
    console.error(`\nwrote ${path}`);
  }
})().catch((e) => { console.error("✖", e.message); process.exit(1); });
