/**
 * MIGRATION DRIFT — does the repo still describe the databases?
 *
 * rstr-agent-plan.md §6, "migration integrity": every CREATE TABLE / ADD COLUMN in the branch must
 * exist on the target, verified against the CATALOG rather than trusting a runner's return.
 *
 * WHY IT EXISTS. On 2026-09-02, `20260611200000_team_build_players_unique_player_role.sql` was found
 * to disagree with reality: the repo declares `ALTER TABLE … ADD CONSTRAINT`, while BOTH databases
 * carry a partial unique index with `WHERE player_id IS NOT NULL`. Someone hit the constraint
 * failing on legitimate NULL-player_id depth placeholders, fixed it, applied the fix to both
 * databases — and STASHED the file instead of committing it. Three months, invisible, on one laptop.
 *
 * A rebuild from `supabase/migrations/` would therefore produce a schema production does not have.
 *
 * READ-ONLY. Catalog introspection only; never reads row data, never writes.
 *
 *   npx tsx scripts/agent/migration-drift.ts            # staging + prod
 *   npx tsx scripts/agent/migration-drift.ts --md
 *
 * ⚠ WHAT IT CANNOT DO
 *   Regex over SQL, not a parser. A later migration may legitimately DROP or rename what an earlier
 *   one created, so "missing" is a CANDIDATE for review, never a proven defect. The high-signal
 *   finding is KIND MISMATCH — the object exists under the declared name but as a different KIND of
 *   thing — because that cannot be explained by a later drop.
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, resolve, basename } from "path";
import { Client, types } from "pg";

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

const MD = process.argv.includes("--md");
const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");

function readEnv(file: string, key: string): string | undefined {
  try {
    const m = readFileSync(resolve(process.cwd(), file), "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

type Decl = { file: string; kind: "index" | "constraint" | "policy" | "function" | "table"; name: string; table?: string };

/** Pull named, checkable objects out of the migration text. */
function parse(sql: string, file: string): Decl[] {
  const out: Decl[] = [];
  const clean = sql.replace(/--[^\n]*/g, "");        // strip line comments; they describe, they don't create

  for (const m of clean.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+"?(?:public\.)?([a-z0-9_ "]+?)"?\s*[\s(]/gi))
    out.push({ file, kind: "index", name: m[1].toLowerCase(), table: m[2].trim().toLowerCase() });

  for (const m of clean.matchAll(/alter\s+table\s+(?:only\s+)?"?(?:public\.)?([a-z0-9_ "]+?)"?\s+add\s+constraint\s+"?([a-z0-9_]+)"?/gi))
    out.push({ file, kind: "constraint", name: m[2].toLowerCase(), table: m[1].trim().toLowerCase() });

  for (const m of clean.matchAll(/create\s+policy\s+"?([^"\n]+?)"?\s+on\s+"?(?:public\.)?([a-z0-9_ "]+?)"?\s*[\s(]/gi))
    out.push({ file, kind: "policy", name: m[1].trim(), table: m[2].trim().toLowerCase() });

  for (const m of clean.matchAll(/create\s+(?:or\s+replace\s+)?function\s+"?(?:public\.)?([a-z0-9_]+)"?\s*\(/gi))
    out.push({ file, kind: "function", name: m[1].toLowerCase() });

  for (const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public\.)?([a-z0-9_ "]+?)"?\s*\(/gi))
    out.push({ file, kind: "table", name: m[1].trim().toLowerCase() });

  return out;
}

(async () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const decls = files.flatMap((f) => parse(readFileSync(join(MIGRATIONS, f), "utf8"), f));

  const targets = [
    { label: "STAGING", env: ".env.local" },
    { label: "PROD", env: ".env.production.local" },
  ];

  const out: string[] = [];
  const P = (s = "") => { out.push(s); console.log(s); };

  P(MD ? "# Migration Drift\n" : "MIGRATION DRIFT — does the repo still describe the databases?");
  P(`${files.length} migration files · ${decls.length} named objects declared`);
  P("⚠ Regex, not a parser. A later migration may legitimately drop or rename an object, so MISSING");
  P("  is a candidate for review. KIND MISMATCH is the high-signal finding — a later drop cannot");
  P("  explain an object existing under the declared name as a different kind of thing.\n");

  for (const t of targets) {
    const conn = readEnv(t.env, "PGURI") || readEnv(t.env, "DATABASE_URL");
    if (!conn) { P(`\n══ ${t.label}: no PGURI in ${t.env} — skipped`); continue; }

    const c = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c.connect();

    const idx = new Set((await c.query(`select indexname from pg_indexes where schemaname='public'`)).rows.map((r) => r.indexname.toLowerCase()));
    const con = new Set((await c.query(`select conname from pg_constraint`)).rows.map((r) => r.conname.toLowerCase()));
    const pol = new Set((await c.query(`select policyname from pg_policies where schemaname='public'`)).rows.map((r) => r.policyname));
    const fun = new Set((await c.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map((r) => r.proname.toLowerCase()));
    const tab = new Set((await c.query(`select tablename from pg_tables where schemaname='public'`)).rows.map((r) => r.tablename.toLowerCase()));
    await c.end();

    const has = (d: Decl) =>
      d.kind === "index" ? idx.has(d.name)
      : d.kind === "constraint" ? con.has(d.name)
      : d.kind === "policy" ? pol.has(d.name)
      : d.kind === "function" ? fun.has(d.name)
      : tab.has(d.name);

    // KIND MISMATCH: declared one way, present as another. This is what the June drift looks like.
    const mismatch = decls.filter((d) => !has(d) && (
      (d.kind === "constraint" && idx.has(d.name)) ||
      (d.kind === "index" && con.has(d.name))
    ));
    const missing = decls.filter((d) => !has(d) && !mismatch.includes(d));

    P(`\n══ ${t.label}`);
    P(`  ⛔ KIND MISMATCH (${mismatch.length}) — declared as one kind, deployed as another`);
    for (const d of mismatch) {
      const actual = idx.has(d.name) ? "INDEX" : "CONSTRAINT";
      P(`     ${d.name}`);
      P(`       declared ${d.kind.toUpperCase()} in ${d.file}`);
      P(`       deployed as ${actual}  ← the repo does not describe this database`);
    }
    if (!mismatch.length) P("     none");

    const byKind: Record<string, Decl[]> = {};
    for (const d of missing) (byKind[d.kind] ??= []).push(d);
    P(`\n  ⚠ DECLARED BUT ABSENT (${missing.length}) — review; a later migration may have dropped it`);
    for (const [k, ds] of Object.entries(byKind)) {
      P(`     ${k} (${ds.length}): ${ds.slice(0, 6).map((d) => d.name).join(", ")}${ds.length > 6 ? ` … +${ds.length - 6}` : ""}`);
    }
    if (!missing.length) P("     none");
  }

  P("\n══ WHAT THIS DOES NOT PROVE");
  P("  Objects exist by NAME. It does not compare column types, index expressions, or policy");
  P("  predicates — two objects can share a name and still differ. It also cannot see objects that");
  P("  exist in a database but were never written down at all.");

  if (MD) {
    const p = resolve(process.cwd(), "docs/MIGRATION_DRIFT.md");
    writeFileSync(p, out.join("\n") + "\n");
    console.error(`\nwrote ${p}`);
  }
})().catch((e) => { console.error("✖", e.message); process.exit(1); });
