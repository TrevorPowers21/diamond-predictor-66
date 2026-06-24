#!/usr/bin/env node
/**
 * Audit: current Overview-display sources vs pitch_log equivalents.
 *
 * Pulls a sample of qualified D1 pitchers and (separately) hitters and
 * shows the side-by-side delta on the fields we plan to flip:
 *
 *   PITCHER:
 *     Stuff+ overall              PM Stuff+              → pitch_log totals
 *     Whiff%                      PM whiff               → pitch_log totals
 *     Per-pitch usage             PM pitch_pct           → pitch_log per-pitch
 *     Per-pitch Stuff+            PM pitch Stuff+        → pitch_log per-pitch
 *
 *   HITTER:
 *     Whiff%                      HM whiff               → pitch_log totals
 *     Contact / Chase             HM rates               → pitch_log totals
 *     Barrel / Hard Hit / Avg EV  HM rates               → pitch_log totals
 *     AVG / OBP / SLG (2026)      HM season row          → pitch_log totals
 *
 * Output: per-player diff lines. Flags big deltas (> threshold) so we
 * can eyeball before flipping any display source. JUCO / D2 players
 * are excluded by joining on D1 Pitching Master / Hitter Master only.
 *
 * Usage:
 *   npm run audit-overview-vs-pitch-log
 *   npm run audit-overview-vs-pitch-log -- --side=pitcher --n=50
 *   npm run audit-overview-vs-pitch-log -- --side=hitter  --n=50
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;

const args = process.argv.slice(2);
const sideArg = args.find((a) => a.startsWith("--side="))?.split("=")[1] ?? "both";
const nArg = parseInt(args.find((a) => a.startsWith("--n="))?.split("=")[1] ?? "50", 10);

const PITCHER_MIN_PITCHES_QUAL = 200;
const HITTER_MIN_PA_QUAL = 50;

const safeDiv = (n: number | null | undefined, d: number | null | undefined) =>
  n != null && d != null && d > 0 ? n / d : null;

const fmt3 = (v: number | null) => (v == null ? "  —  " : v.toFixed(3));
const fmt1 = (v: number | null) => (v == null ? " — " : v.toFixed(1));
const fmtPct = (v: number | null) => (v == null ? "  — " : `${(v * 100).toFixed(1)}%`);
const fmtDelta = (a: number | null, b: number | null) => {
  if (a == null || b == null) return "    —";
  const d = b - a;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}`;
};

async function fetchPage<T>(table: string, cols: string, filters: Record<string, any>, from = 0): Promise<T[]> {
  let q = (supabase as any).from(table).select(cols).range(from, from + 999);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data } = await q;
  return (data ?? []) as T[];
}

async function fetchAll<T>(table: string, cols: string, filters: Record<string, any>): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const page = await fetchPage<T>(table, cols, filters, from);
    out.push(...page);
    if (page.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function auditPitchers() {
  console.log(`\n=== PITCHER side · current Overview source vs pitch_log ===`);
  console.log(`Qualifier: total_pitches >= ${PITCHER_MIN_PITCHES_QUAL} on pitch_log 'all' dim\n`);

  const plRows = await fetchAll<any>(
    "pitch_log_pitcher_totals",
    "pitcher_id, total_pitches, total_swings, total_whiffs, stuff_plus_sum, stuff_plus_data_pitches",
    { season: SEASON, dimension_key: "all" },
  );
  const plQual = plRows.filter((r) => r.total_pitches >= PITCHER_MIN_PITCHES_QUAL);

  // Sample n pitchers from the qualified pool — spread by Stuff+ percentile
  // so we get top / middle / bottom representation.
  const withStuff = plQual
    .map((r) => ({ ...r, plStuff: safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches) }))
    .filter((r) => r.plStuff != null)
    .sort((a, b) => (b.plStuff! - a.plStuff!));
  const step = Math.max(1, Math.floor(withStuff.length / nArg));
  const sampled = withStuff.filter((_, i) => i % step === 0).slice(0, nArg);

  const ids = sampled.map((r) => r.pitcher_id);
  // Pitching Master row — joined by source_player_id. PM columns are
  // lowercased: stuff_plus (no '+'), miss_pct (whiff), playerFullName.
  const { data: pmData } = await (supabase as any)
    .from("Pitching Master")
    .select(`source_player_id, playerFullName, Team, Season, stuff_plus, miss_pct, blended_stuff_plus`)
    .in("source_player_id", ids)
    .eq("Season", SEASON);
  const pmByPid = new Map<string, any>();
  for (const r of pmData ?? []) pmByPid.set(r.source_player_id, r);

  // pitch_log per-pitch breakdown for sampled pitchers
  const { data: plByPitch } = await (supabase as any)
    .from("pitch_log_pitcher_by_pitch_type")
    .select("pitcher_id, pitch_type_reclassified, pitches, stuff_plus_sum, data_pitches")
    .in("pitcher_id", ids)
    .eq("season", SEASON)
    .eq("dimension_key", "all");
  const plByPitchByPid = new Map<string, any[]>();
  for (const r of plByPitch ?? []) {
    if (!plByPitchByPid.has(r.pitcher_id)) plByPitchByPid.set(r.pitcher_id, []);
    plByPitchByPid.get(r.pitcher_id)!.push(r);
  }

  // ─── Stuff+ overall ────────────────────────────────────────────────
  console.log(`-- Stuff+ overall --`);
  console.log(
    `${"Pitcher".padEnd(28)} ${"Team".padEnd(15)} ${"PM Stuff+".padStart(10)} ${"pitch_log".padStart(10)} ${"Δ".padStart(7)} ${"flag"}`,
  );
  console.log("─".repeat(85));
  let bigDeltas = 0;
  let pmMissing = 0;
  for (const r of sampled) {
    const pm = pmByPid.get(r.pitcher_id);
    const name = pm?.playerFullName ?? `?? ${r.pitcher_id}`;
    const pmStuff = pm?.stuff_plus != null ? Number(pm.stuff_plus) : null;
    const plStuff = r.plStuff!;
    if (pmStuff == null) pmMissing++;
    const delta = pmStuff != null ? plStuff - pmStuff : null;
    const flag = delta != null && Math.abs(delta) > 5 ? "  LARGE" : delta == null ? "  PM_MISSING" : "";
    if (flag === "  LARGE") bigDeltas++;
    console.log(
      `${name.padEnd(28)} ${(pm?.Team ?? "—").padEnd(15)} ${fmt1(pmStuff).padStart(10)} ${fmt1(plStuff).padStart(10)} ${fmtDelta(pmStuff, plStuff).padStart(7)} ${flag}`,
    );
  }
  console.log(`\nSummary: ${sampled.length} pitchers · ${bigDeltas} with |Δ| > 5 · ${pmMissing} missing PM Stuff+`);

  // ─── Whiff% ────────────────────────────────────────────────────────
  console.log(`\n-- Whiff% --`);
  console.log(
    `${"Pitcher".padEnd(28)} ${"PM whiff%".padStart(10)} ${"pitch_log".padStart(10)} ${"Δ pts".padStart(7)}`,
  );
  console.log("─".repeat(70));
  for (const r of sampled.slice(0, 15)) {
    const pm = pmByPid.get(r.pitcher_id);
    const name = pm?.playerFullName ?? `?? ${r.pitcher_id}`;
    const pmWhiff = pm?.miss_pct != null ? Number(pm.miss_pct) : null;
    const plWhiff = safeDiv(r.total_whiffs, r.total_swings);
    const pmW = pmWhiff != null ? pmWhiff / 100 : null; // PM stores as 0-100, pitch_log as 0-1
    const dlt = plWhiff != null && pmW != null ? (plWhiff - pmW) * 100 : null;
    console.log(
      `${name.padEnd(28)} ${fmtPct(pmW).padStart(10)} ${fmtPct(plWhiff).padStart(10)} ${dlt == null ? "    —" : (dlt >= 0 ? "+" : "") + dlt.toFixed(1)}`,
    );
  }

  // ─── Per-pitch Stuff+ + USAGE: pitcher_stuff_plus_inputs vs pitch_log ─
  console.log(`\n-- Per-pitch Stuff+ + USAGE (spot-check 5 pitchers) --`);
  console.log(`   PSP-I = pitcher_stuff_plus_inputs (current Overview source)`);
  console.log(`   plog  = pitch_log_pitcher_by_pitch_type (new source)`);
  const { data: spiRows } = await (supabase as any)
    .from("pitcher_stuff_plus_inputs")
    .select("source_player_id, pitch_type, stuff_plus, pitches, whiff_pct")
    .in("source_player_id", sampled.slice(0, 5).map((r) => r.pitcher_id))
    .eq("season", SEASON);
  const spiByPid = new Map<string, any[]>();
  for (const r of spiRows ?? []) {
    if (!spiByPid.has(r.source_player_id)) spiByPid.set(r.source_player_id, []);
    spiByPid.get(r.source_player_id)!.push(r);
  }
  for (const r of sampled.slice(0, 5)) {
    const pm = pmByPid.get(r.pitcher_id);
    const name = pm?.playerFullName ?? r.pitcher_id;
    console.log(`\n  ${name} (${pm?.Team ?? "—"}):`);
    const plPitchRows = plByPitchByPid.get(r.pitcher_id) ?? [];
    const plTotalPitches = plPitchRows.reduce((s, x) => s + (x.pitches ?? 0), 0);
    const spiRows = spiByPid.get(r.pitcher_id) ?? [];
    const spiTotalPitches = spiRows.reduce((s, x) => s + (x.pitches ?? 0), 0);
    const spiByType = new Map(spiRows.map((x) => [x.pitch_type, x]));
    console.log(
      `    ${"Pitch".padEnd(20)} ${"plog%".padStart(7)} ${"PSP-I%".padStart(7)} ${"plog Stuff+".padStart(12)} ${"PSP-I Stuff+".padStart(13)} ${"Δ".padStart(7)}`,
    );
    for (const pr of plPitchRows.sort((a, b) => b.pitches - a.pitches)) {
      const plUsage = plTotalPitches > 0 ? (pr.pitches / plTotalPitches) : null;
      const plPitchStuff = safeDiv(pr.stuff_plus_sum, pr.data_pitches);
      const spi = spiByType.get(pr.pitch_type_reclassified);
      const spiUsage = spi?.pitches != null && spiTotalPitches > 0 ? spi.pitches / spiTotalPitches : null;
      const spiStuff = spi?.stuff_plus != null ? Number(spi.stuff_plus) : null;
      const delta = plPitchStuff != null && spiStuff != null ? plPitchStuff - spiStuff : null;
      console.log(
        `    ${(pr.pitch_type_reclassified ?? "?").padEnd(20)} ${fmtPct(plUsage).padStart(7)} ${fmtPct(spiUsage).padStart(7)} ${fmt1(plPitchStuff).padStart(12)} ${fmt1(spiStuff).padStart(13)} ${fmtDelta(spiStuff, plPitchStuff).padStart(7)}`,
      );
    }
  }
}

async function auditHitters() {
  console.log(`\n\n=== HITTER side · current Overview source vs pitch_log ===`);
  console.log(`Qualifier: pa >= ${HITTER_MIN_PA_QUAL} on pitch_log 'all' dim\n`);

  const plRows = await fetchAll<any>(
    "pitch_log_hitter_totals",
    "batter_id, pa, ab, hits_single, hits_double, hits_triple, hits_hr, bb, hbp, sac, k, total_swings, total_whiffs, total_in_zone, total_chases, total_pitches, batted_balls_in_play, batted_hard_hit, batted_barrels, ev_sum, batted_balls_with_ev",
    { season: SEASON, dimension_key: "all" },
  );
  const plQual = plRows.filter((r) => r.pa >= HITTER_MIN_PA_QUAL);
  const step = Math.max(1, Math.floor(plQual.length / nArg));
  const sampled = plQual.filter((_, i) => i % step === 0).slice(0, nArg);

  const ids = sampled.map((r) => r.batter_id);
  // HM uses lowercase capitalized: AVG/OBP/SLG, lowercased rate fields,
  // playerFullName. NO whiff or hard_hit columns — derive from contact (1-contact)
  // and use avg_exit_velo as the EV proxy.
  const { data: hmData } = await (supabase as any)
    .from("Hitter Master")
    .select(`source_player_id, playerFullName, Team, Season, pa, AVG, OBP, SLG, contact, chase, barrel, avg_exit_velo`)
    .in("source_player_id", ids)
    .eq("Season", SEASON);
  const hmByPid = new Map<string, any>();
  for (const r of hmData ?? []) hmByPid.set(r.source_player_id, r);

  // ─── 2026 slash + key rates ──────────────────────────────────────────
  console.log(`-- 2026 slash + key rates --`);
  console.log(
    `${"Hitter".padEnd(28)} ${"HM AVG".padStart(7)} ${"plog".padStart(6)} ${"Δ".padStart(6)}  ${"HM Cnt%".padStart(7)} ${"plog".padStart(7)} ${"Δ pts".padStart(7)}  ${"HM Bar%".padStart(7)} ${"plog".padStart(7)} ${"Δ pts".padStart(7)}  ${"HM EV".padStart(6)} ${"plog".padStart(6)} ${"Δ".padStart(5)}`,
  );
  console.log("─".repeat(132));
  let avgDeltas = 0;
  let contactDeltas = 0;
  let barrelDeltas = 0;
  for (const r of sampled.slice(0, 25)) {
    const hm = hmByPid.get(r.batter_id);
    const name = hm?.playerFullName ?? `?? ${r.batter_id}`;

    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const plAvg = safeDiv(hits, r.ab);
    const hmAvg = hm?.AVG != null ? Number(hm.AVG) : null;
    const dAvg = plAvg != null && hmAvg != null ? plAvg - hmAvg : null;
    if (dAvg != null && Math.abs(dAvg) > 0.02) avgDeltas++;

    const plContact = r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null;
    const hmContact = hm?.contact != null ? Number(hm.contact) / 100 : null;
    const dContact = plContact != null && hmContact != null ? (plContact - hmContact) * 100 : null;
    if (dContact != null && Math.abs(dContact) > 3) contactDeltas++;

    const plBarrel = safeDiv(r.batted_barrels, r.batted_balls_in_play);
    const hmBarrel = hm?.barrel != null ? Number(hm.barrel) / 100 : null;
    const dBarrel = plBarrel != null && hmBarrel != null ? (plBarrel - hmBarrel) * 100 : null;
    if (dBarrel != null && Math.abs(dBarrel) > 3) barrelDeltas++;

    const plEV = safeDiv(r.ev_sum, r.batted_balls_with_ev);
    const hmEV = hm?.avg_exit_velo != null ? Number(hm.avg_exit_velo) : null;
    const dEV = plEV != null && hmEV != null ? plEV - hmEV : null;

    console.log(
      `${name.padEnd(28)} ${fmt3(hmAvg).padStart(7)} ${fmt3(plAvg).padStart(6)} ${dAvg == null ? "    —" : (dAvg >= 0 ? "+" : "") + dAvg.toFixed(3)}  ${fmtPct(hmContact).padStart(7)} ${fmtPct(plContact).padStart(7)} ${dContact == null ? "    —" : (dContact >= 0 ? "+" : "") + dContact.toFixed(1) + "pts"}  ${fmtPct(hmBarrel).padStart(7)} ${fmtPct(plBarrel).padStart(7)} ${dBarrel == null ? "    —" : (dBarrel >= 0 ? "+" : "") + dBarrel.toFixed(1) + "pts"}  ${fmt1(hmEV).padStart(6)} ${fmt1(plEV).padStart(6)} ${dEV == null ? "    —" : (dEV >= 0 ? "+" : "") + dEV.toFixed(1)}`,
    );
  }
  console.log(`\nSummary: 25 sample hitters · ${avgDeltas} with |ΔAVG| > .020 · ${contactDeltas} with |ΔContact| > 3pts · ${barrelDeltas} with |ΔBarrel| > 3pts`);
}

async function main() {
  if (sideArg === "pitcher" || sideArg === "both") await auditPitchers();
  if (sideArg === "hitter" || sideArg === "both") await auditHitters();
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
