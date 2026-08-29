/**
 * A2 — RECLASSIFY PROD WRITER (committed). Runs the v2 classifier (`reclassify_v2.ts`) on prod data and stamps
 * pitch_log.pitch_type_reclassified + classification_version + needs_review. REGENERATE on prod (not copy).
 * Per-pitcher (classification needs the pitcher's whole arsenal): load all pitches → group by pitcher → derive
 * primaryFB velo → classify → build (uniq_pitch_id → label). Then keyset UPDATE over a DIRECT prod session.
 *
 *   DRY RUN (read-only, no PGURI):  npx tsx --env-file .env.production.local scripts/reclassify_prod.ts --dry-run
 *   REAL (needs PGURI):  PGURI='postgresql://…:5432/postgres' PROGRESS_LOG=/tmp/reclass_prod.log npx tsx --env-file .env.production.local scripts/reclassify_prod.ts --go
 * env: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (read), PGURI (direct prod session for --go), CLASS_VERSION.
 */
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { appendFileSync, writeFileSync } from "node:fs";
import { classifyPitcher, armHBof, mean, type P } from "./reclassify_v2";

const SEASON = 2026;
const args = process.argv;
const DRY = args.includes("--dry-run"), GO = args.includes("--go");
const CLASS_VERSION = process.env.CLASS_VERSION || "v2-ranges-2026-08-28";
const LOG = process.env.PROGRESS_LOG || "/tmp/reclass_prod.log";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => { const s = `[${new Date().toISOString()}] ${m}`; console.log(s); if (GO) appendFileSync(LOG, s + "\n"); };

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
const isProd = /trbvxuoliwrfowibatkm/.test(url);

/** primaryFB velo = mean velo of the pitcher's raw fastball family (FA/SI); fallback = all pitches. */
function pfbVelo(ps: P[]): number { const fb = ps.filter((p) => p.raw === "FA" || p.raw === "SI").map((p) => p.velo); return fb.length >= 3 ? mean(fb) : mean(ps.map((p) => p.velo)); }

/** Load every classifiable pitch (venue-corrected), grouped by pitcher. Keyset over uniq_pitch_id. */
async function loadByPitcher(): Promise<Map<string, P[]>> {
  const byP = new Map<string, P[]>(); let last = "", n = 0; const t0 = Date.now();
  for (;;) {
    let data: any[] | null = null;
    for (let a = 1; a <= 6; a++) {
      try {
        const res = await sb.from("pitch_log_corrected")
          .select("uniq_pitch_id,pitcher_id,pitch_type,pitcher_hand,release_velocity,ivb_corrected,hb_corrected,spin,pitch_type_reclassified")
          .eq("season", SEASON).eq("is_data", true).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
        if (res.error) throw new Error(res.error.message); data = res.data; break;
      } catch (e: any) { log(`  read ${a}/6 failed: ${e.message}`); if (a === 6) throw e; await sleep(3000 * a); }
    }
    if (!data || !data.length) break;
    for (const r of data) {
      if (r.release_velocity == null || r.ivb_corrected == null || r.hb_corrected == null) continue;
      (byP.get(r.pitcher_id) ?? byP.set(r.pitcher_id, []).get(r.pitcher_id)!).push(
        { uniq: r.uniq_pitch_id, raw: r.pitch_type, hand: r.pitcher_hand, velo: r.release_velocity, ivb: r.ivb_corrected, hb: r.hb_corrected, spin: r.spin, stored: r.pitch_type_reclassified });
      n++;
    }
    last = data[data.length - 1].uniq_pitch_id;
    if (n % 200000 < 1000) log(`  loaded ${n} pitches / ${byP.size} pitchers [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
  }
  log(`load DONE: ${n} pitches / ${byP.size} pitchers [${((Date.now() - t0) / 60000).toFixed(1)}m]`);
  return byP;
}

/** Classify every pitcher → uniq_pitch_id → {label, review}. */
function classifyAll(byP: Map<string, P[]>): Map<string, { label: string; review: boolean }> {
  const out = new Map<string, { label: string; review: boolean }>();
  const dist: Record<string, number> = {}; let review = 0;
  for (const [, ps] of byP) {
    const usable = ps.filter((p) => p.velo != null && p.ivb != null && p.hb != null);
    if (usable.length < 1) continue;
    const labels = classifyPitcher(usable, pfbVelo(usable));
    for (const [uniq, g] of labels) { out.set(uniq, g); dist[g.label] = (dist[g.label] ?? 0) + 1; if (g.review) review++; }
  }
  log(`classified ${out.size} pitches. needs_review ${(100 * review / out.size).toFixed(1)}%`);
  log(`distribution: ${Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${(100 * n / out.size).toFixed(1)}%`).join("  ")}`);
  return out;
}

async function main() {
  log(`A2 reclassify_prod — env=${isProd ? "PROD" : "non-prod"} class_version='${CLASS_VERSION}' mode=${DRY ? "DRY-RUN" : GO ? "GO" : "?"}`);
  const byP = await loadByPitcher();
  const labels = classifyAll(byP);
  if (DRY || !GO) {
    log(`\n=== DRY RUN complete — NO writes. ${labels.size} labels computed. To execute: provide PGURI + "prod, now?" ===`);
    // ── COMPARE v2 vs what prod ALREADY has (normalize the old naming) ──
    const NORM: Record<string, string> = { "4-Seam Fastball": "4S FB", "4-Seam": "4S FB", "Four-Seam Fastball": "4S FB" };
    const norm = (s: string | null) => (s == null ? null : (NORM[s] ?? s));
    let same = 0, cmp = 0, missing = 0; const moves: Record<string, number> = {}; const storedDist: Record<string, number> = {};
    for (const [, ps] of byP) for (const p of ps) {
      const v2 = labels.get(p.uniq)?.label; if (!v2) continue;
      const st = norm(p.stored);
      if (st == null) { missing++; continue; }
      storedDist[st] = (storedDist[st] ?? 0) + 1;
      cmp++; if (st === v2) same++; else moves[`${st} → ${v2}`] = (moves[`${st} → ${v2}`] ?? 0) + 1;
    }
    log(`\n── v2 vs PROD's EXISTING pitch_type_reclassified ──`);
    log(`compared ${cmp} pitches (prod had no label on ${missing} of the classifiable rows)`);
    log(`AGREEMENT: ${same}/${cmp} = ${cmp ? (100 * same / cmp).toFixed(1) : "?"}%   → v2 would CHANGE ${cmp - same} pitches (${cmp ? (100 * (cmp - same) / cmp).toFixed(1) : "?"}%)`);
    log(`prod existing distribution: ${Object.entries(storedDist).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${(100 * n / cmp).toFixed(1)}%`).join("  ")}`);
    log(`top label MOVES (prod → v2):`);
    Object.entries(moves).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => log(`   ${String(n).padStart(7)}  ${k}`));
    return;
  }
  // ---- GO: write via DIRECT prod session ----
  // ★ STAGE-0 0.6 (2026-08-29): the §11.12 decision (standardize on v2 in BOTH envs) requires this writer to be
  // able to target STAGING too. The guard is now double-keyed: --target must match the PGURI project ref, so it is
  // still impossible to hit prod by accident, but staging is reachable.
  const uri = process.env.PGURI || "";
  const targetArg = (args.find((a) => a.startsWith("--target=")) || "").split("=")[1] || "prod";
  const PROD_REF = "trbvxuoliwrfowibatkm", STG_REF = "slrxowawbijbjrkozqlj";
  const wantRef = targetArg === "staging" ? STG_REF : PROD_REF;
  if (targetArg !== "prod" && targetArg !== "staging") { log(`✗ --target must be prod|staging (got '${targetArg}')`); process.exit(1); }
  if (!uri.includes(wantRef)) { log(`✗ PGURI does not point at ${targetArg} (${wantRef}) — aborting`); process.exit(1); }
  if (targetArg === "prod" && uri.includes(STG_REF)) { log("✗ --target=prod but PGURI is staging — aborting"); process.exit(1); }
  log(`TARGET = ${targetArg.toUpperCase()} (${wantRef})`);
  writeFileSync(LOG, "");
  const mkClient = () => new pg.Client({ connectionString: uri, keepAlive: true, query_timeout: 600000 });
  let c = mkClient();
  async function runq(sql: string, params?: any[]): Promise<any> {
    for (let a = 1; a <= 4; a++) { try { return await c.query(sql, params); } catch (e: any) { log(`  db ${a}/4: ${e.message} — reconnect`); try { await c.end(); } catch {} if (a === 4) throw e; await sleep(3000 * a); c = mkClient(); await c.connect(); await c.query("set statement_timeout = 0;"); } }
  }
  await c.connect(); await c.query("set statement_timeout = 0;"); log("connected to prod (direct).");
  await c.query(`create table if not exists _reclass_fix (uniq_pitch_id text primary key, label text, needs_review boolean default false)`);
  // ★ STAGE-0 0.3 (2026-08-29): _reclass_pf (per-pitcher primary-FB velo) does NOT exist on prod and has NO producer
  // anywhere in the repo — every reference is a READ. compute_pitch_log_stuff_plus.ts:132-135 does process.exit(1)
  // without it, so prod scoring would abort. We already compute exactly this value via pfbVelo() during
  // classification, so materialize it here as a by-product. Idempotent upsert.
  await c.query(`create table if not exists _reclass_pf (pitcher_id text primary key, pf_velo double precision)`);
  {
    const pfRows = [...byP.entries()].map(([pid, ps]) => [pid, pfbVelo(ps.filter((p) => p.velo != null))] as [string, number])
      .filter(([, v]) => Number.isFinite(v));
    for (let i = 0; i < pfRows.length; i += 1000) {
      const b = pfRows.slice(i, i + 1000);
      await runq(`insert into _reclass_pf (pitcher_id, pf_velo) select * from unnest($1::text[],$2::double precision[])
                  on conflict (pitcher_id) do update set pf_velo = excluded.pf_velo`,
        [b.map((r) => r[0]), b.map((r) => r[1])]);
    }
    log(`_reclass_pf materialized: ${pfRows.length} pitchers`);
  }
  // PHASE 1 — load computed labels into prod _reclass_fix (batched unnest, resumable)
  const rows = [...labels.entries()]; let loaded = Number((await c.query(`select count(*)::bigint n from _reclass_fix`)).rows[0].n);
  log(`load: _reclass_fix has ${loaded}; inserting ${rows.length} computed labels`);
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    await runq(`insert into _reclass_fix (uniq_pitch_id,label,needs_review) select * from unnest($1::text[],$2::text[],$3::boolean[]) on conflict (uniq_pitch_id) do update set label=excluded.label, needs_review=excluded.needs_review`,
      [batch.map((r) => r[0]), batch.map((r) => r[1].label), batch.map((r) => r[1].review)]);
    if (i % 200000 < 1000) log(`  loaded ${i + batch.length}/${rows.length}`);
    await sleep(60);
  }
  // PHASE 2 — keyset UPDATE pitch_log from _reclass_fix (idempotent, resumable)
  const total = Number((await c.query(`select count(*)::bigint n from _reclass_fix`)).rows[0].n);
  const KPAGE = 20000, THROTTLE = 300; let kl = "", updated = 0, batch = 0, done = 0; const t2 = Date.now();
  log(`update: keyset PAGE=${KPAGE} over ${total} rows. resumable.`);
  for (;;) {
    const hi = (await runq(`select max(uniq_pitch_id) hi from (select uniq_pitch_id from _reclass_fix where uniq_pitch_id > $1 order by uniq_pitch_id limit ${KPAGE}) t`, [kl])).rows[0].hi as string | null;
    if (hi == null) break;
    const r = await runq(
      `update pitch_log pl set pitch_type_reclassified=f.label, classification_version=$3, needs_review=f.needs_review
       from _reclass_fix f where f.uniq_pitch_id=pl.uniq_pitch_id and f.uniq_pitch_id > $1 and f.uniq_pitch_id <= $2
         and (pl.pitch_type_reclassified is distinct from f.label or pl.classification_version is distinct from $3 or pl.needs_review is distinct from f.needs_review)`, [kl, hi, CLASS_VERSION]);
    batch++; updated += r.rowCount ?? 0; done += KPAGE;
    log(`✓ batch ${batch} (…${hi.slice(-8)}) upd=${r.rowCount} cum=${updated} [~${Math.min(100, Math.round(100 * done / total))}%]`);
    kl = hi; await sleep(THROTTLE);
  }
  const v = (await runq(`select count(*) filter (where classification_version=$1)::bigint ver, count(*)::bigint tot from pitch_log`, [CLASS_VERSION])).rows[0];
  log(`DONE — reclass prod: batches=${batch}, updated=${updated}. verify: version_stamped=${v.ver}/${v.tot}`);
  await c.end();
}
main().catch((e) => { log(`✗ ${e.message}`); process.exit(1); });
