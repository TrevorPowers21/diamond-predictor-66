/**
 * Phase C step 20 — park_code UPDATE, CHUNKED + PACED over a DIRECT session.
 * Each ctid-block-range chunk commits on its own (resumable via `is distinct from`),
 * uncapped (statement_timeout=0), 3s breather between chunks so we don't redline disk IO.
 * Live progress appended to a log file. Reads PGURI from env. One-off; delete after.
 */
import pg from "pg";
import { appendFileSync, writeFileSync } from "node:fs";

const uri = process.env.PGURI || "";
const LOG = process.env.PROGRESS_LOG || "/tmp/pc_progress.log";
if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI missing or not prod."); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => { console.log(m); appendFileSync(LOG, m + "\n"); };

const client = new pg.Client({ connectionString: uri });
const BATCH = 20000; // blocks per chunk
try {
  writeFileSync(LOG, "");
  await client.connect();
  await client.query("set statement_timeout = 0;");
  const bc = await client.query("select (pg_relation_size('pitch_log')/8192)::bigint n");
  const MAXBLOCK = Number(bc.rows[0].n) + 2000;
  log(`connected. heap blocks ~${MAXBLOCK - 2000}; chunking in ${BATCH}-block ranges, uncapped, 3s paced.`);
  let totalUpd = 0; const t0 = Date.now();
  for (let b = 0; b <= MAXBLOCK; b += BATCH) {
    const b2 = b + BATCH, cs = Date.now();
    const r = await client.query(
      `update pitch_log pl set park_code = f.park_code
       from _park_code_fix f
       where f.uniq_pitch_id = pl.uniq_pitch_id
         and pl.ctid >= '(${b},0)'::tid and pl.ctid < '(${b2},0)'::tid
         and pl.park_code is distinct from f.park_code;`
    );
    totalUpd += r.rowCount ?? 0;
    log(`✓ blocks ${b}-${b2} upd=${r.rowCount} cum=${totalUpd} [${((Date.now() - cs) / 1000).toFixed(0)}s chunk | ${((Date.now() - t0) / 60000).toFixed(1)}m total]`);
    await sleep(3000);
  }
  const v = await client.query(`select count(*)::bigint tot, count(*) filter (where park_code is not null)::bigint nn from pitch_log`);
  log(`DONE — total updated this run: ${totalUpd}. verify: total=${v.rows[0].tot} nonnull=${v.rows[0].nn} null=${Number(v.rows[0].tot) - Number(v.rows[0].nn)} [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
} catch (e: any) {
  log(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
