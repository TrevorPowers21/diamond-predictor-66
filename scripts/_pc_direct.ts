/**
 * Phase C step 20 — park_code UPDATE over a DIRECT Postgres session (survives long runs).
 * Reads the connection string from env PGURI (never written to disk). One-off; delete after.
 *   PGURI='postgresql://...pooler.supabase.com:5432/postgres' npx tsx scripts/_pc_direct.ts
 */
import pg from "pg";

const uri = process.env.PGURI || "";
if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI missing or not the prod project ref."); process.exit(1); }

const client = new pg.Client({ connectionString: uri });
const t0 = Date.now();
try {
  await client.connect();
  await client.query("set statement_timeout = '3600s';");
  console.log("connected (direct session). running park_code UPDATE — this holds the connection to completion...");
  const res = await client.query(
    `update pitch_log pl set park_code = f.park_code
     from _park_code_fix f
     where f.uniq_pitch_id = pl.uniq_pitch_id and pl.park_code is distinct from f.park_code;`
  );
  console.log(`✓ UPDATE committed — rows changed: ${res.rowCount} [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  const v = await client.query(
    `select count(*)::bigint tot, count(*) filter (where park_code is not null)::bigint nn from pitch_log;`
  );
  const { tot, nn } = v.rows[0];
  console.log(`verify pitch_log: total=${tot} nonnull=${nn} null=${Number(tot) - Number(nn)}`);
} catch (e: any) {
  console.error(`✗ ${e.message} [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  process.exit(1);
} finally {
  await client.end();
}
