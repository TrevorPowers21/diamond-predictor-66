/**
 * VACUUM FULL pitch_log over a DIRECT Postgres session (de-bloat before the combined derived-column UPDATE).
 * Reads PGURI from env (never written to disk). One-off; delete after.
 *   PGURI='postgresql://...:5432/postgres' npx tsx scripts/_vacuum.ts
 */
import pg from "pg";

const uri = process.env.PGURI || "";
if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI missing or not the prod project ref."); process.exit(1); }

const client = new pg.Client({ connectionString: uri });
const t0 = Date.now();
try {
  await client.connect();
  await client.query("set statement_timeout = 0;"); // VACUUM must not be killed
  const before = await client.query(`select pg_size_pretty(pg_total_relation_size('pitch_log')) sz, pg_total_relation_size('pitch_log') b`);
  console.log(`before: pitch_log total size = ${before.rows[0].sz}`);
  console.log("running VACUUM FULL pitch_log (exclusive lock; ~15-20 min)...");
  await client.query("vacuum (full, analyze) pitch_log;");
  const after = await client.query(`select pg_size_pretty(pg_total_relation_size('pitch_log')) sz, pg_total_relation_size('pitch_log') b`);
  const pct = (100 * (1 - Number(after.rows[0].b) / Number(before.rows[0].b))).toFixed(0);
  console.log(`✓ VACUUM FULL done — after size = ${after.rows[0].sz} (reclaimed ~${pct}%) [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
} catch (e: any) {
  console.error(`✗ ${e.message} [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  process.exit(1);
} finally {
  await client.end();
}
