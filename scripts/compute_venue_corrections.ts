/**
 * Venue movement-effect correction producer (Stuff+ Phase 1 step 0).
 * REBUILDS the lost `venue_correction_persist.sql` — a committed, re-runnable producer.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/compute_venue_corrections.ts             # staging, DRY (compute + report + emit SQL file)
 *   npx tsx --env-file-if-exists=.env.local scripts/compute_venue_corrections.ts --apply     # staging, create table + insert + view
 *   npx tsx --env-file-if-exists=.env.production.local scripts/compute_venue_corrections.ts --prod --apply
 *
 * METHOD (locked doctrine, memory project_venue_movement_correction):
 *  (1) LOO — per-venue IVB/HB residual off each pitcher's OWN season mean EXCLUDING that venue
 *      (visiting-pitcher logic; only pitchers who also threw elsewhere inform a park).
 *  (2) Empirical-Bayes shrinkage toward 0, PITCHER as sampling unit: B_v = τ²/(τ²+s²_v),
 *      s²_v = Var(pitcher residuals at v)/n_v ; τ² = Var(raw offset across venues) − mean(s²_v)
 *      (method of moments; floored at 0). Conservative: under-correct noise > over-correct signal.
 *  (3) NO THRESHOLD applying the layer — corrected = raw − shrunk offset for EVERY pitch; a clean
 *      park shrinks to ≈0 by construction. Per-SEASON fixture (drift not stable across seasons).
 * Correctness check: staging τ should land ≈ 0.63″ IVB / 0.66″ HB (memory), centering golden ≈ 0.
 * Stamped `venue_correction_version='v1-2026-loo-eb'`. Regenerate on prod (per-env venue ids).
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const IS_PROD = process.argv.includes("--prod");
const APPLY = process.argv.includes("--apply");
const SEASON = 2026;
const VERSION = "v1-2026-loo-eb";
const MIN_CELL = 1;      // min pitches at a venue for a (pitcher,venue) residual to count
const MIN_ELSE = 1;      // min pitches ELSEWHERE (LOO base) — matches the original: any visiting pitcher informs

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const looksProd = /trbvxuoliwrfowibatkm/.test(url);
if (looksProd && !IS_PROD) { console.error("✗ URL looks PROD but --prod not passed. Refusing."); process.exit(1); }
if (IS_PROD && !looksProd) { console.error("✗ --prod passed but URL is not prod. Refusing."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
console.log(`target: ${IS_PROD ? "🔴 PROD" : "STAGING"}${APPLY ? " [APPLY]" : " [DRY — emit SQL only]"}`);

const variance = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
};

async function main() {
  // 1) aggregate per-(pitcher, venue) sums via a temp table (fast over 2.58M rows)
  console.log("aggregating per-(pitcher,venue) movement…");
  const aggSql = `
    drop table if exists _venue_pitcher_agg;
    create table _venue_pitcher_agg as
    select pitcher_id, game_venue_id vid, count(*) n, sum(ivb) sivb, sum(hb) shb
    from pitch_log
    where season = ${SEASON} and ivb is not null and hb is not null and game_venue_id is not null and is_data = true
    group by pitcher_id, game_venue_id;
    notify pgrst, 'reload schema';`;
  const { error: aggErr } = await (sb as any).rpc("exec_sql", { sql: aggSql });
  if (aggErr) throw new Error(`agg: ${aggErr.message}`);

  // read the agg (retry the first page while PostgREST reloads its schema cache after the DDL)
  type Cell = { pitcher_id: string; vid: string; n: number; sivb: number; shb: number };
  const cells: Cell[] = [];
  const readPage = async (f: number) => (sb as any).from("_venue_pitcher_agg").select("pitcher_id,vid,n,sivb,shb").range(f, f + 999);
  let first: any = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    first = await readPage(0);
    if (!first.error) break;
    if (!/schema cache|does not exist|Could not find/.test(first.error.message)) throw new Error(`read agg: ${first.error.message}`);
    await (sb as any).rpc("exec_sql", { sql: "notify pgrst, 'reload schema';" }); // nudge + a network round-trip of spacing
  }
  if (first.error) throw new Error(`read agg (schema cache never refreshed): ${first.error.message}`);
  for (const r of first.data || []) cells.push({ pitcher_id: String(r.pitcher_id), vid: String(r.vid), n: Number(r.n), sivb: Number(r.sivb), shb: Number(r.shb) });
  if ((first.data || []).length === 1000) {
    for (let f = 1000; ; f += 1000) {
      const { data, error } = await readPage(f);
      if (error) throw new Error(`read agg pg: ${error.message}`);
      for (const r of data || []) cells.push({ pitcher_id: String(r.pitcher_id), vid: String(r.vid), n: Number(r.n), sivb: Number(r.sivb), shb: Number(r.shb) });
      if (!data || data.length < 1000) break;
    }
  }
  console.log(`  ${cells.length} (pitcher,venue) cells`);

  // per-pitcher totals (for LOO base)
  const pTot = new Map<string, { n: number; sivb: number; shb: number }>();
  for (const c of cells) {
    const t = pTot.get(c.pitcher_id) || { n: 0, sivb: 0, shb: 0 };
    t.n += c.n; t.sivb += c.sivb; t.shb += c.shb; pTot.set(c.pitcher_id, t);
  }

  // 2) LOO residuals, collected per venue
  type VAcc = { ivb: number[]; hb: number[]; pitches: number };
  const byVenue = new Map<string, VAcc>();
  let totalPitchesAllVenues = 0;
  const venuePitches = new Map<string, number>();
  for (const c of cells) {
    venuePitches.set(c.vid, (venuePitches.get(c.vid) || 0) + c.n);
    totalPitchesAllVenues += c.n;
  }
  for (const c of cells) {
    const t = pTot.get(c.pitcher_id)!;
    const nElse = t.n - c.n;
    if (c.n < MIN_CELL || nElse < MIN_ELSE) continue;               // thin cell → skip residual
    const meanAtV_ivb = c.sivb / c.n, meanElse_ivb = (t.sivb - c.sivb) / nElse;
    const meanAtV_hb = c.shb / c.n, meanElse_hb = (t.shb - c.shb) / nElse;
    const acc = byVenue.get(c.vid) || { ivb: [], hb: [], pitches: 0 };
    acc.ivb.push(meanAtV_ivb - meanElse_ivb);
    acc.hb.push(meanAtV_hb - meanElse_hb);
    byVenue.set(c.vid, acc);
  }

  // 3) venue raw offsets + s²_v (SE² of the venue mean)
  type VStat = { vid: string; nV: number; rawIvb: number; rawHb: number; s2Ivb: number; s2Hb: number };
  const stats: VStat[] = [];
  for (const [vid, a] of byVenue) {
    const nV = a.ivb.length;
    if (nV < 2) continue;                                          // need ≥2 informing pitchers
    const rawIvb = a.ivb.reduce((x, y) => x + y, 0) / nV;
    const rawHb = a.hb.reduce((x, y) => x + y, 0) / nV;
    stats.push({ vid, nV, rawIvb, rawHb, s2Ivb: variance(a.ivb) / nV, s2Hb: variance(a.hb) / nV });
  }
  console.log(`  ${stats.length} venues with ≥2 informing visiting pitchers`);

  // 4) empirical-Bayes: τ² (method of moments) then B_v shrink
  const tau2 = (raw: number[], s2: number[]): number => Math.max(0, variance(raw) - (s2.reduce((a, b) => a + b, 0) / s2.length));
  const tau2Ivb = tau2(stats.map(s => s.rawIvb), stats.map(s => s.s2Ivb));
  const tau2Hb = tau2(stats.map(s => s.rawHb), stats.map(s => s.s2Hb));
  console.log(`  τ (IVB) = ${Math.sqrt(tau2Ivb).toFixed(3)}″   τ (HB) = ${Math.sqrt(tau2Hb).toFixed(3)}″   (memory ≈ 0.63 / 0.66)`);

  // Schema matches the existing staging table exactly: game_venue_id + ivb_corr/hb_corr (shrunk
  // offsets) + b_ivb/b_hb (shrinkage factors) + n_pitchers (informing) + n_pitches (total at venue).
  const rows = stats.map(s => {
    const bIvb = tau2Ivb / (tau2Ivb + s.s2Ivb), bHb = tau2Hb / (tau2Hb + s.s2Hb);
    return {
      game_venue_id: s.vid, season: SEASON,
      ivb_corr: bIvb * s.rawIvb, hb_corr: bHb * s.rawHb,
      b_ivb: bIvb, b_hb: bHb, n_pitchers: s.nV, n_pitches: venuePitches.get(s.vid) || 0,
    };
  });

  // 5) validation — centering golden (pitch-weighted applied correction ≈ 0)
  let wIvb = 0, wHb = 0, wN = 0;
  for (const r of rows) { wIvb += r.ivb_corr * r.n_pitches; wHb += r.hb_corr * r.n_pitches; wN += r.n_pitches; }
  console.log(`  CENTERING GOLDEN: pitch-wt applied corr  IVB ${(wIvb / wN).toFixed(4)}″  HB ${(wHb / wN).toFixed(4)}″  (want ≈ 0)`);
  const worstIvb = [...rows].sort((a, b) => Math.abs(b.ivb_corr) - Math.abs(a.ivb_corr)).slice(0, 5);
  console.log(`  biggest IVB offsets (post-shrink): ${worstIvb.map(r => `${r.game_venue_id}:${r.ivb_corr.toFixed(2)}(n=${r.n_pitchers})`).join("  ")}`);

  // 5b) if a fixture already exists (staging original paste), prove faithfulness vs it
  const { data: existing } = await (sb as any).from("venue_movement_corrections").select("game_venue_id,ivb_corr,hb_corr,b_ivb,n_pitchers,n_pitches").eq("season", SEASON);
  if (existing && existing.length) {
    const mine = new Map(rows.map(r => [String(r.game_venue_id), r]));
    let mIvb = 0, mHb = 0, mB = 0, matched = 0, pitchesMatch = 0, pitchersMatch = 0;
    const worst: any[] = [];
    for (const e of existing) { const m = mine.get(String(e.game_venue_id)); if (!m) continue; matched++;
      const dI = Math.abs(Number(e.ivb_corr) - m.ivb_corr);
      mIvb = Math.max(mIvb, dI); mHb = Math.max(mHb, Math.abs(Number(e.hb_corr) - m.hb_corr)); mB = Math.max(mB, Math.abs(Number(e.b_ivb) - m.b_ivb));
      if (Number(e.n_pitches) === m.n_pitches) pitchesMatch++;
      if (Number(e.n_pitchers) === m.n_pitchers) pitchersMatch++;
      worst.push({ v: e.game_venue_id, dI, eP: e.n_pitches, mP: m.n_pitches, ePr: e.n_pitchers, mPr: m.n_pitchers, eC: Number(e.ivb_corr), mC: m.ivb_corr });
    }
    console.log(`  vs EXISTING fixture (${existing.length} rows, matched ${matched}): max Δ ivb_corr ${mIvb.toFixed(4)}″  hb_corr ${mHb.toFixed(4)}″  b_ivb ${mB.toFixed(4)}`);
    console.log(`  n_pitches exact-match: ${pitchesMatch}/${matched}   n_pitchers exact-match: ${pitchersMatch}/${matched}`);
    console.log("  biggest ivb_corr divergences (venue: existing→mine, n_pitches e/m, n_pitchers e/m):");
    worst.sort((a, b) => b.dI - a.dI).slice(0, 6).forEach(w => console.log(`    ${w.v}: ${w.eC.toFixed(2)}→${w.mC.toFixed(2)}  pitches ${w.eP}/${w.mP}  pitchers ${w.ePr}/${w.mPr}`));
  }

  // 6) emit SQL (table + inserts + view) — schema MATCHES the existing staging fixture exactly.
  //    Always write the file; --apply also runs it.
  const values = rows.map(r => `('${r.game_venue_id}',${SEASON},${r.ivb_corr.toFixed(6)},${r.hb_corr.toFixed(6)},${r.b_ivb.toFixed(6)},${r.b_hb.toFixed(6)},${r.n_pitchers},${r.n_pitches},'${VERSION}')`).join(",\n");
  const ddl = `-- venue_movement_corrections + pitch_log_corrected VIEW (${VERSION}, season ${SEASON})
-- Generated by scripts/compute_venue_corrections.ts (LOO + empirical-Bayes). REGENERATE per env
-- (game_venue_id + τ differ). Schema matches the original staging fixture.
create table if not exists venue_movement_corrections (
  season int not null, game_venue_id text not null,
  ivb_corr numeric, hb_corr numeric, b_ivb numeric, b_hb numeric,
  n_pitchers int, n_pitches int, venue_correction_version text,
  created_at timestamptz default now(),
  primary key (game_venue_id, season)
);
alter table venue_movement_corrections enable row level security;
delete from venue_movement_corrections where season=${SEASON} and venue_correction_version='${VERSION}';
insert into venue_movement_corrections
  (game_venue_id,season,ivb_corr,hb_corr,b_ivb,b_hb,n_pitchers,n_pitches,venue_correction_version) values
${values};
-- Full pitch_log passthrough + corrected movement (matches the existing view contract). Consumers
-- (Stuff+ classification + scoring) read ivb_corrected/hb_corrected. Corrected = raw − shrunk offset.
create or replace view pitch_log_corrected as
select pl.*,
       pl.ivb - coalesce(vc.ivb_corr,0) as ivb_corrected,
       pl.hb  - coalesce(vc.hb_corr,0)  as hb_corrected,
       vc.venue_correction_version
from pitch_log pl
left join venue_movement_corrections vc
  on vc.game_venue_id = pl.game_venue_id::text and vc.season = pl.season;
`;
  const outFile = `scripts/sql/venue_correction_persist_${IS_PROD ? "prod" : "staging"}.sql`;
  fs.writeFileSync(outFile, ddl);
  console.log(`  wrote ${rows.length} venue rows → ${outFile}`);

  if (APPLY) {
    console.log("applying (create table + insert + view)…");
    const { error } = await (sb as any).rpc("exec_sql", { sql: ddl });
    if (error) throw new Error(`apply: ${error.message}`);
    console.log("  ✅ applied.");
  } else {
    console.log("  DRY — re-run with --apply to write the table + view.");
  }
  await (sb as any).rpc("exec_sql", { sql: "drop table if exists _venue_pitcher_agg;" });
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
