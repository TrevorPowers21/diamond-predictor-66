/**
 * STUFF+ RECLASSIFICATION ROLLOUT — copy staging `_reclass_result` (bit-exact, env-independent by uniq_pitch_id)
 * → prod pitch_log.pitch_type_reclassified + classification_version + needs_review.
 * Same proven pattern as _next_derived.ts (is_conf/sequence): load staging → prod `_reclass_fix`, then keyset UPDATE
 * over a DIRECT prod session, per-batch commit, `is distinct from` (idempotent/resumable), throttle.
 *
 *   DRY RUN (read-only, no PGURI):  npx tsx scripts/_reclass_rollout.ts --dry-run
 *   REAL (needs PGURI):  PGURI='postgresql://...:5432/postgres' PROGRESS_LOG=/tmp/reclass_rollout.log npx tsx scripts/_reclass_rollout.ts --go
 * env: STAGING_URL/STAGING_KEY (staging read), PROD_URL/PROD_KEY (dry-run prod read), PGURI (real write), CLASS_VERSION
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv;
const DRY = args.includes("--dry-run");
const GO = args.includes("--go");
const CLASS_VERSION = process.env.CLASS_VERSION || "v1-anchor-2026-08-17";
const LOG = process.env.PROGRESS_LOG || "/tmp/reclass_rollout.log";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => { const s = `[${new Date().toISOString()}] ${m}`; console.log(s); if (GO) appendFileSync(LOG, s + "\n"); };

const stagingUrl = process.env.STAGING_URL || process.env.VITE_SUPABASE_URL || "";
if (!/slrxowawbijbjrkozqlj/.test(stagingUrl)) { console.error("✗ STAGING_URL is not staging"); process.exit(1); }
const staging = createClient(stagingUrl, process.env.STAGING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;

async function dryRun() {
  console.log(`\n=== DRY RUN (read-only) — class_version='${CLASS_VERSION}' ===\n`);
  // 1) staging _reclass_result: columns + count
  const { data: sample, error: se } = await staging.from("_reclass_result").select("*").limit(3);
  if (se) { console.error("✗ cannot read staging _reclass_result:", se.message); process.exit(1); }
  const cols = Object.keys(sample?.[0] ?? {});
  const { count: srcCount } = await staging.from("_reclass_result").select("*", { count: "exact", head: true });
  console.log(`staging _reclass_result: columns = [${cols.join(", ")}]`);
  console.log(`staging _reclass_result: row count = ${srcCount}`);
  console.log(`sample rows:`, JSON.stringify(sample?.slice(0, 3)));
  const labelCol = cols.find((c) => /label|reclass|pitch_type/i.test(c) && c !== "uniq_pitch_id");
  const nrCol = cols.find((c) => /needs_review/i.test(c));
  console.log(`→ detected label column: '${labelCol}'; needs_review column: '${nrCol ?? "(none — will join from _reclass_map or default false)"}'`);

  // 2) prod target columns present? (PostgREST read; column-missing → error)
  const prodUrl = process.env.PROD_URL || "";
  if (!/trbvxuoliwrfowibatkm/.test(prodUrl)) { console.log("\n(skip prod checks — PROD_URL not set to prod; provide PROD_URL/PROD_KEY to sample the join)"); return; }
  const prod = createClient(prodUrl, process.env.PROD_KEY!, { auth: { persistSession: false } }) as any;
  const { error: pe } = await prod.from("pitch_log").select("uniq_pitch_id,pitch_type_reclassified,classification_version,needs_review").limit(1);
  console.log(`\nprod pitch_log target columns: ${pe ? "✗ MISSING → " + pe.message : "✓ all present (pitch_type_reclassified, classification_version, needs_review)"}`);
  if (pe) return;

  // 3) sample the staging→prod join: old prod label vs new staging label
  const ids = (sample ?? []).map((r: any) => r.uniq_pitch_id);
  const more = await staging.from("_reclass_result").select("*").limit(12);
  const allIds = [...new Set([...ids, ...((more.data ?? []).map((r: any) => r.uniq_pitch_id))])].slice(0, 12);
  const { data: prodRows } = await prod.from("pitch_log").select("uniq_pitch_id,pitch_type,pitch_type_reclassified").in("uniq_pitch_id", allIds);
  const newBy = new Map<string, string>((more.data ?? []).map((r: any) => [r.uniq_pitch_id, r[labelCol!]]));
  console.log(`\nsample join (prod uniq_pitch_id → old_reclass ⇒ NEW label from staging):`);
  let changed = 0;
  for (const r of prodRows ?? []) {
    const nu = newBy.get(r.uniq_pitch_id);
    const diff = nu !== r.pitch_type_reclassified;
    if (diff) changed++;
    console.log(`  ${r.uniq_pitch_id.slice(-14)}  raw=${(r.pitch_type ?? "—").padEnd(4)}  old=${(r.pitch_type_reclassified ?? "—").padEnd(12)} ⇒ ${nu ?? "—"}${diff ? "   *CHANGED*" : ""}`);
  }
  console.log(`\n${prodRows?.length ?? 0} sampled; ${changed} would change. (full write = ${srcCount} source rows, only differing rows touched via \`is distinct from\`.)`);
  console.log(`\n=== DRY RUN complete — NO writes. To execute: provide PGURI + say "prod, now?" ===\n`);
}

async function realGo() {
  const uri = process.env.PGURI || "";
  if (!/trbvxuoliwrfowibatkm/.test(uri)) { console.error("✗ PGURI is not the prod direct session"); process.exit(1); }
  const labelCol = process.env.LABEL_COL || "label";
  const nrCol = process.env.NR_COL || ""; // empty → needs_review defaults false
  writeFileSync(LOG, "");
  const mkClient = () => new pg.Client({ connectionString: uri, keepAlive: true, query_timeout: 600000 });
  let c = mkClient();
  async function runq(sql: string, params?: any[]): Promise<any> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try { return await c.query(sql, params); }
      catch (e: any) { log(`  db query failed (try ${attempt}/4): ${e.message} — reconnecting`); try { await c.end(); } catch {}
        if (attempt === 4) throw e; await sleep(3000 * attempt); c = mkClient(); await c.connect(); await c.query("set statement_timeout = 0;"); }
    }
  }
  try {
    await c.connect(); await c.query("set statement_timeout = 0;"); log(`connected to prod (direct). class_version='${CLASS_VERSION}'`);
    const have = (await c.query(`select column_name from information_schema.columns where table_name='pitch_log' and column_name = any($1)`,
      [["pitch_type_reclassified", "classification_version", "needs_review"]])).rows.map((r) => r.column_name);
    const missing = ["pitch_type_reclassified", "classification_version", "needs_review"].filter((x) => !have.includes(x));
    if (missing.length) { log(`✗ prod pitch_log missing: ${missing.join(",")}`); process.exit(1); }

    // PHASE 1: load _reclass_fix from staging (resumable)
    await c.query(`create table if not exists _reclass_fix (uniq_pitch_id text primary key, label text, needs_review boolean default false)`);
    let last = (await c.query(`select coalesce(max(uniq_pitch_id),'') m from _reclass_fix`)).rows[0].m as string;
    let loaded = Number((await c.query(`select count(*)::bigint n from _reclass_fix`)).rows[0].n);
    log(`load: _reclass_fix has ${loaded}; resuming from '${last.slice(-10)}'`);
    const PAGE = 1000, t1 = Date.now();
    for (;;) {
      let data: any[] | null = null;
      for (let a = 1; a <= 6; a++) {
        try { const sel = nrCol ? `uniq_pitch_id,${labelCol},${nrCol}` : `uniq_pitch_id,${labelCol}`;
          const res = await staging.from("_reclass_result").select(sel).gt("uniq_pitch_id", last).order("uniq_pitch_id", { ascending: true }).limit(PAGE);
          if (res.error) throw new Error(res.error.message); data = res.data; break;
        } catch (e: any) { log(`  staging read ${a}/6 failed: ${e.message}`); if (a === 6) process.exit(1); await sleep(3000 * a); }
      }
      if (!data || data.length === 0) break;
      await c.query(`insert into _reclass_fix (uniq_pitch_id,label,needs_review) select * from unnest($1::text[],$2::text[],$3::boolean[]) on conflict (uniq_pitch_id) do nothing`,
        [data.map((r: any) => r.uniq_pitch_id), data.map((r: any) => r[labelCol]), data.map((r: any) => (nrCol ? !!r[nrCol] : false))]);
      loaded += data.length; last = data[data.length - 1].uniq_pitch_id;
      if (loaded % 200000 < PAGE) log(`  loaded ${loaded} [${((Date.now() - t1) / 60000).toFixed(1)}m]`);
      await sleep(120);
    }
    log(`load DONE: _reclass_fix = ${loaded} [${((Date.now() - t1) / 60000).toFixed(1)}m]`);

    // PHASE 2: keyset UPDATE pitch_log, resumable
    const total = Number((await c.query(`select count(*)::bigint n from _reclass_fix`)).rows[0].n);
    const KPAGE = 20000, THROTTLE = 300; let kl = "", updated = 0, batch = 0, done = 0; const t2 = Date.now();
    log(`update: keyset PAGE=${KPAGE}, throttle=${THROTTLE}ms over ${total} rows. resumable.`);
    for (;;) {
      const hi = (await runq(`select max(uniq_pitch_id) hi from (select uniq_pitch_id from _reclass_fix where uniq_pitch_id > $1 order by uniq_pitch_id limit ${KPAGE}) t`, [kl])).rows[0].hi as string | null;
      if (hi == null) break;
      const cs = Date.now();
      const r = await runq(
        `update pitch_log pl set pitch_type_reclassified=f.label, classification_version=$3, needs_review=f.needs_review
         from _reclass_fix f where f.uniq_pitch_id=pl.uniq_pitch_id and f.uniq_pitch_id > $1 and f.uniq_pitch_id <= $2
           and (pl.pitch_type_reclassified is distinct from f.label
                or pl.classification_version is distinct from $3
                or pl.needs_review is distinct from f.needs_review)`, [kl, hi, CLASS_VERSION]);
      batch++; updated += r.rowCount ?? 0; done += KPAGE;
      log(`✓ batch ${batch} (…${hi.slice(-8)}) upd=${r.rowCount} cum=${updated} [~${Math.min(100, Math.round(100 * done / total))}% | ${((Date.now() - cs) / 1000).toFixed(0)}s | ${((Date.now() - t2) / 60000).toFixed(1)}m]`);
      kl = hi; await sleep(THROTTLE);
    }
    const v = (await runq(`select count(*) filter (where pitch_type_reclassified is not null)::bigint lbl,
       count(*) filter (where classification_version=$1)::bigint ver, count(*)::bigint tot from pitch_log`, [CLASS_VERSION])).rows[0];
    log(`DONE — reclass rollout: batches=${batch}, updated=${updated}. verify: labeled=${v.lbl} version_stamped=${v.ver}/${v.tot} [${((Date.now() - t2) / 60000).toFixed(1)}m]`);
  } catch (e: any) { log(`✗ ${e.message}`); process.exit(1); } finally { await c.end(); }
}

if (DRY) dryRun().catch((e) => { console.error(e); process.exit(1); });
else if (GO) realGo().catch((e) => { console.error(e); process.exit(1); });
else console.log("usage: --dry-run  |  --go (needs PGURI)");
