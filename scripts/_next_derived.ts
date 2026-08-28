/**
 * Phase C steps 21+22 — is_conference_game + sequence (pitch_num_in_game / ab_num_in_game / pitch_num_in_ab),
 * COMBINED into one keyset pass, sourced from STAGING (all env-independent, keyed by uniq_pitch_id).
 * Same proven pattern as park_code (_pc_keyset.ts): direct prod session, keyset on PK, per-batch commit,
 * `is distinct from` (resumable), throttle. Runs AFTER park_code (chained at the shell level) — one heavy job per table.
 *
 * env: PGURI (prod direct pooler+password), STAGING_URL, STAGING_KEY, PROGRESS_LOG
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, writeFileSync } from "node:fs";

const uri = process.env.PGURI || "";
const LOG = process.env.PROGRESS_LOG || "/tmp/next_derived.log";
if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI not prod"); process.exit(1); }
const staging = createClient(process.env.STAGING_URL!, process.env.STAGING_KEY!, { auth: { persistSession: false } });
if (/trbvxuoliwrfowibatkm/.test(process.env.STAGING_URL || "")) { console.error("✗ STAGING_URL is prod!"); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => { const s = `[${new Date().toISOString()}] ${m}`; console.log(s); appendFileSync(LOG, s + "\n"); };

const COLS = ["is_conference_game", "pitch_num_in_game", "ab_num_in_game", "pitch_num_in_ab"] as const;
const mkClient = () => new pg.Client({ connectionString: uri, keepAlive: true, query_timeout: 600000 });
let c = mkClient();
// resilient query: on connection stall/drop, reconnect and retry (idempotent updates make this safe)
async function runq(sql: string, params?: any[]): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await c.query(sql, params); }
    catch (e: any) {
      log(`  db query failed (try ${attempt}/4): ${e.message} — reconnecting`);
      try { await c.end(); } catch {}
      if (attempt === 4) throw e;
      await sleep(3000 * attempt);
      c = mkClient(); await c.connect(); await c.query("set statement_timeout = 0;");
    }
  }
}

try {
  writeFileSync(LOG, "");
  await c.connect();
  await c.query("set statement_timeout = 0;");
  log("connected to prod (direct).");

  // sanity: prod has the target columns
  const have = (await c.query(
    `select column_name from information_schema.columns where table_name='pitch_log' and column_name = any($1)`, [COLS as unknown as string[]]
  )).rows.map((r) => r.column_name);
  const missing = COLS.filter((x) => !have.includes(x));
  if (missing.length) { log(`✗ prod pitch_log missing columns: ${missing.join(",")} — aborting`); process.exit(1); }

  // ---- PHASE 1: load _derived_fix from staging (resumable) ----
  await c.query(`create table if not exists _derived_fix (
     uniq_pitch_id text primary key, is_conference_game boolean,
     pitch_num_in_game int, ab_num_in_game int, pitch_num_in_ab int)`);
  let last = (await c.query(`select coalesce(max(uniq_pitch_id),'') m from _derived_fix`)).rows[0].m as string;
  let loaded = Number((await c.query(`select count(*)::bigint n from _derived_fix`)).rows[0].n);
  log(`load: _derived_fix has ${loaded} rows; resuming from '${last.slice(-10)}'`);
  const PAGE = 1000; const t1 = Date.now(); // PostgREST caps reads at 1000 rows/request
  for (;;) {
    let data: any[] | null = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await staging
          .from("pitch_log")
          .select("uniq_pitch_id,is_conference_game,pitch_num_in_game,ab_num_in_game,pitch_num_in_ab")
          .gt("uniq_pitch_id", last).order("uniq_pitch_id", { ascending: true }).limit(PAGE);
        if (res.error) throw new Error(res.error.message);
        data = res.data; break;
      } catch (e: any) {
        log(`  staging read attempt ${attempt}/6 failed: ${e.message} — retrying`);
        if (attempt === 6) { log(`✗ staging read gave up after 6 tries`); process.exit(1); }
        await sleep(3000 * attempt);
      }
    }
    if (!data || data.length === 0) break;
    await c.query(
      `insert into _derived_fix (uniq_pitch_id,is_conference_game,pitch_num_in_game,ab_num_in_game,pitch_num_in_ab)
       select * from unnest($1::text[],$2::boolean[],$3::int[],$4::int[],$5::int[])
       on conflict (uniq_pitch_id) do nothing`,
      [data.map((r: any) => r.uniq_pitch_id), data.map((r: any) => r.is_conference_game),
       data.map((r: any) => r.pitch_num_in_game), data.map((r: any) => r.ab_num_in_game), data.map((r: any) => r.pitch_num_in_ab)]);
    loaded += data.length; last = data[data.length - 1].uniq_pitch_id;
    if (loaded % 200000 < PAGE) log(`  loaded ${loaded} [${((Date.now() - t1) / 60000).toFixed(1)}m]`);
    // NOTE: do NOT break on data.length<PAGE — PostgREST caps at 1000 so pages are always ~PAGE; rely on empty-check above.
    await sleep(120);
  }
  log(`load DONE: _derived_fix = ${loaded} rows [${((Date.now() - t1) / 60000).toFixed(1)}m]`);

  // ---- PHASE 2: keyset UPDATE pitch_log (is_conf + sequence together), resumable ----
  const total = Number((await c.query(`select count(*)::bigint n from _derived_fix`)).rows[0].n);
  const KPAGE = 20000, THROTTLE = 300; let kl = "", updated = 0, batch = 0, done = 0; const t2 = Date.now();
  log(`update: keyset PAGE=${KPAGE}, throttle=${THROTTLE}ms over ${total} source rows. resumable.`);
  for (;;) {
    const hi = (await runq(
      `select max(uniq_pitch_id) hi from (select uniq_pitch_id from _derived_fix where uniq_pitch_id > $1 order by uniq_pitch_id limit ${KPAGE}) t`, [kl]
    )).rows[0].hi as string | null;
    if (hi == null) break;
    const cs = Date.now();
    const r = await runq(
      `update pitch_log pl set is_conference_game=f.is_conference_game, pitch_num_in_game=f.pitch_num_in_game,
              ab_num_in_game=f.ab_num_in_game, pitch_num_in_ab=f.pitch_num_in_ab
       from _derived_fix f
       where f.uniq_pitch_id=pl.uniq_pitch_id and f.uniq_pitch_id > $1 and f.uniq_pitch_id <= $2
         and (pl.is_conference_game is distinct from f.is_conference_game
              or pl.pitch_num_in_game is distinct from f.pitch_num_in_game
              or pl.ab_num_in_game is distinct from f.ab_num_in_game
              or pl.pitch_num_in_ab is distinct from f.pitch_num_in_ab)`, [kl, hi]);
    batch++; updated += r.rowCount ?? 0; done += KPAGE;
    log(`✓ batch ${batch} (…${hi.slice(-8)}) upd=${r.rowCount} cum=${updated} [~${Math.min(100, Math.round(100 * done / total))}% | ${((Date.now() - cs) / 1000).toFixed(0)}s | ${((Date.now() - t2) / 60000).toFixed(1)}m]`);
    kl = hi; await sleep(THROTTLE);
  }
  const v = (await runq(
    `select count(*) filter (where is_conference_game is not null)::bigint conf,
            count(*) filter (where pitch_num_in_game is not null)::bigint seq, count(*)::bigint tot from pitch_log`)).rows[0];
  log(`DONE — is_conf/seq update: batches=${batch}, updated=${updated}. verify: is_conf_filled=${v.conf} seq_filled=${v.seq}/${v.tot} [${((Date.now() - t2) / 60000).toFixed(1)}m]`);
} catch (e: any) {
  log(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await c.end();
}
