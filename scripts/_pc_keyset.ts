/**
 * Phase C step 20 — park_code backfill, KEYSET-paginated over a DIRECT session.
 * Correct rewrite per the migration review:
 *  - Batches by STABLE primary key (uniq_pitch_id) ranges, NOT ctid.
 *  - Join keyed on PK both sides (_park_code_fix PK + pitch_log PK) — index range scan, no hash rebuild.
 *  - `is distinct from` guard → idempotent + RESUMABLE (skips the ~1.2M already done).
 *  - Throttle between batches so the disk IO burst budget can breathe.
 *  - Per-batch commit (autocommit) → progress persists; monitored via direct conn, no zombies.
 *  - NO VACUUM FULL. One heavy job per table.
 * Reads PGURI + PROGRESS_LOG from env. One-off; delete after.
 */
import pg from "pg";
import { appendFileSync, writeFileSync } from "node:fs";

const uri = process.env.PGURI || "";
const LOG = process.env.PROGRESS_LOG || "/tmp/pc_keyset.log";
if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI missing or not prod."); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => { console.log(m); appendFileSync(LOG, m + "\n"); };

const PAGE = 20000;      // rows per keyset page
const THROTTLE_MS = 300; // breather between batches

const client = new pg.Client({ connectionString: uri });
try {
  writeFileSync(LOG, "");
  await client.connect();
  await client.query("set statement_timeout = 0;"); // batches are small; never kill mid-batch
  const total = Number((await client.query("select count(*)::bigint n from _park_code_fix")).rows[0].n);
  log(`connected. source _park_code_fix rows=${total}; keyset PAGE=${PAGE}, throttle=${THROTTLE_MS}ms. resumable.`);
  let last = ""; let done = 0, updated = 0, batch = 0; const t0 = Date.now();
  for (;;) {
    // upper bound of this page = the PAGE-th uniq_pitch_id above `last` (stable keyset window)
    const hiRes = await client.query(
      `select max(uniq_pitch_id) hi from (
         select uniq_pitch_id from _park_code_fix where uniq_pitch_id > $1 order by uniq_pitch_id limit ${PAGE}
       ) t`, [last]);
    const hi = hiRes.rows[0].hi as string | null;
    if (hi == null) break; // no rows left
    const cs = Date.now();
    const r = await client.query(
      `update pitch_log pl set park_code = f.park_code
       from _park_code_fix f
       where f.uniq_pitch_id = pl.uniq_pitch_id
         and f.uniq_pitch_id > $1 and f.uniq_pitch_id <= $2
         and pl.park_code is distinct from f.park_code;`, [last, hi]);
    batch++; updated += r.rowCount ?? 0; done += PAGE;
    log(`✓ batch ${batch} (…${hi.slice(-8)}) upd=${r.rowCount} cum_upd=${updated} [~${Math.min(100, Math.round(100 * done / total))}% scanned | ${((Date.now() - cs) / 1000).toFixed(0)}s | ${((Date.now() - t0) / 60000).toFixed(1)}m]`);
    last = hi;
    await sleep(THROTTLE_MS);
  }
  const v = await client.query(`select count(*) filter (where park_code is not null)::bigint nn, count(*)::bigint tot from pitch_log`);
  log(`DONE — batches=${batch}, rows updated this run=${updated}. verify: park_code_filled=${v.rows[0].nn}/${v.rows[0].tot} [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
} catch (e: any) {
  log(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}
