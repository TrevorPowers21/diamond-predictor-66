#!/usr/bin/env node
/**
 * Populate Conference Stats env+ slash-ratio columns + add JUCO district rows.
 *
 * Two phases:
 *   1. UPDATE existing D1 conference rows: compute env+ values vs season's NCAA
 *      averages and store in ba_plus / obp_plus / slg_plus / iso_plus columns.
 *      (Renamed columns: ba_power_rating already holds the sub-metric-derived
 *      power rating; this phase populates the freed *_plus columns with the
 *      slash-ratio env+ stat.)
 *
 *   2. INSERT 10 JUCO district rows: pulls PA-weighted hitter rates from
 *      Hitter Master, team-weighted Stuff+ from locked regional baselines,
 *      IP-weighted pitching rates from Pitching Master. Conference identifier
 *      shape: "NJCAA D1 <District> District" so simulator lookups work.
 *
 * Both phases work against staging only. The simulator (PlayerComparison +
 * TeamBuilder) reads ConfStats raw rates AND computes env+ on-the-fly today
 * — the stored env+ values are a fallback for direct query usage and audit.
 */
import { createInterface } from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REGIONAL_BASELINE_OVERLAY } from "../src/lib/juco/regionalBaselineOverlay";

const CONFIRM_PHRASE = "yes-populate-conf-stats";
const BATCH_SIZE = 50;

const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);

function parseArgs(argv: string[]): { apply: boolean } {
  for (const a of argv) {
    if (a === "--apply") return { apply: true };
    if (a === "--help" || a === "-h") {
      console.log("Usage: npm run populate-conf-stats [-- --apply]");
      process.exit(0);
    }
  }
  return { apply: false };
}

async function confirm(): Promise<void> {
  warn(`This will WRITE to staging. Type "${CONFIRM_PHRASE}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("> ")).trim();
  rl.close();
  if (answer !== CONFIRM_PHRASE) { err("Aborted."); process.exit(1); }
  ok("Confirmed. Proceeding.");
}

// ── Phase 1: Populate env+ on existing D1 conference rows ────────────────
async function populateD1EnvPlus(staging: SupabaseClient, apply: boolean) {
  step("Phase 1: D1 Conference Stats env+ population");

  // Load NCAA averages per season
  const { data: ncaaRows, error: ncaaErr } = await staging
    .from("ncaa_averages")
    .select("season, avg, obp, slg, iso");
  if (ncaaErr) throw new Error(`ncaa_averages: ${ncaaErr.message}`);
  const ncaaBySeason = new Map<number, { avg: number; obp: number; slg: number; iso: number }>();
  for (const r of (ncaaRows ?? []) as any[]) {
    ncaaBySeason.set(r.season, { avg: r.avg, obp: r.obp, slg: r.slg, iso: r.iso });
  }
  info(`NCAA averages loaded for ${ncaaBySeason.size} seasons`);

  // Load all CS rows (conference_id + season is composite key — no `id` col)
  const { data: csRows, error: csErr } = await staging
    .from("Conference Stats")
    .select(`conference_id, "conference abbreviation", season, "AVG", "OBP", "ISO"`);
  if (csErr) throw new Error(`Conference Stats: ${csErr.message}`);
  info(`Loaded ${csRows?.length ?? 0} Conference Stats rows`);

  let toUpdate = 0, skipped = 0;
  const updates: Array<{ conference_id: string; season: number; ba_plus: number | null; obp_plus: number | null; slg_plus: number | null; iso_plus: number | null }> = [];

  for (const r of (csRows ?? []) as any[]) {
    const ncaa = ncaaBySeason.get(r.season);
    if (!ncaa) { skipped++; continue; }
    const avg = r.AVG, obp = r.OBP, iso = r.ISO;
    if (avg == null && obp == null && iso == null) { skipped++; continue; }
    if (!r.conference_id) { skipped++; continue; }
    const slg = avg != null && iso != null ? avg + iso : null;
    updates.push({
      conference_id: r.conference_id,
      season: r.season,
      ba_plus: avg != null && ncaa.avg ? Math.round((avg / ncaa.avg) * 1000) / 10 : null,
      obp_plus: obp != null && ncaa.obp ? Math.round((obp / ncaa.obp) * 1000) / 10 : null,
      slg_plus: slg != null && ncaa.slg ? Math.round((slg / ncaa.slg) * 1000) / 10 : null,
      iso_plus: iso != null && ncaa.iso ? Math.round((iso / ncaa.iso) * 1000) / 10 : null,
    });
    toUpdate++;
  }
  info(`Will update: ${toUpdate}, skipped: ${skipped}`);

  if (!apply) { info("(dry-run — not writing)"); return; }

  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(chunk.map(async (u) => {
      const { error } = await staging.from("Conference Stats")
        .update({ ba_plus: u.ba_plus, obp_plus: u.obp_plus, slg_plus: u.slg_plus, iso_plus: u.iso_plus })
        .eq("conference_id", u.conference_id)
        .eq("season", u.season);
      return error;
    }));
    const failed = results.filter(Boolean).length;
    if (failed > 0) warn(`Batch ${i}: ${failed} failed`);
    done += chunk.length - failed;
  }
  ok(`D1 env+ populated: ${done}/${updates.length} rows`);
}

// ── Phase 2: Insert 10 JUCO district rows ────────────────────────────────
const SEASON = 2026;

type DistrictInfo = { district: string; regions: number[]; teamCountByRegion: Record<number, number> };

const DISTRICTS: DistrictInfo[] = [
  { district: "South Atlantic", regions: [8], teamCountByRegion: { 8: 17 } },
  { district: "Southwest", regions: [5], teamCountByRegion: { 5: 19 } },
  { district: "Mid-South", regions: [14], teamCountByRegion: { 14: 13 } },
  { district: "Plains", regions: [6], teamCountByRegion: { 6: 18 } },
  { district: "Appalachian", regions: [7, 17], teamCountByRegion: { 7: 11, 17: 5 } },
  { district: "East", regions: [10, 20], teamCountByRegion: { 10: 6, 20: 2 } },
  { district: "Midwest", regions: [4, 11, 24], teamCountByRegion: { 4: 5, 11: 3, 24: 11 } },
  { district: "South", regions: [22, 23], teamCountByRegion: { 22: 10, 23: 4 } },
  { district: "South Central", regions: [2, 16], teamCountByRegion: { 2: 5, 16: 9 } },
  { district: "West", regions: [1, 9, 18], teamCountByRegion: { 1: 7, 9: 8, 18: 4 } },
];

async function populateJucoDistricts(staging: SupabaseClient, apply: boolean) {
  step("Phase 2: JUCO district rows insertion");

  // Load NCAA 2026 averages for env+ calc
  const { data: ncaaRow } = await staging.from("ncaa_averages").select("avg, obp, slg, iso, era, fip, whip, k9, bb9, hr9").eq("season", SEASON).maybeSingle();
  if (!ncaaRow) throw new Error(`No ncaa_averages row for season ${SEASON}`);
  const ncaa = ncaaRow as any;

  // Pull Teams Table → district lookup map (PostgREST embed flaky w/o explicit FK)
  const { data: teamsTable } = await staging
    .from("Teams Table")
    .select("id, region, district");
  const teamDistrict = new Map<string, string>();
  for (const t of (teamsTable ?? []) as any[]) {
    if (t.id && t.district) teamDistrict.set(t.id, t.district);
  }
  info(`Teams Table district map: ${teamDistrict.size} entries`);

  // Pull JUCO hitters — paged to bypass default 1000-row limit
  const hitters: any[] = [];
  let hFrom = 0;
  while (true) {
    const { data } = await staging
      .from("Hitter Master")
      .select(`pa, "AVG", "OBP", "ISO", "TeamID", ba_power_rating, obp_power_rating, iso_power_rating, overall_power_rating`)
      .eq("division", "NJCAA_D1")
      .eq("Season", SEASON)
      .gte("pa", 30)
      .range(hFrom, hFrom + 999);
    if (!data || data.length === 0) break;
    hitters.push(...data);
    if (data.length < 1000) break;
    hFrom += 1000;
  }
  info(`Loaded ${hitters.length} JUCO hitters (pa>=30)`);

  // Pull JUCO pitchers — paged
  const pitchers: any[] = [];
  let pFrom = 0;
  while (true) {
    const { data } = await staging
      .from("Pitching Master")
      .select(`"IP", "ERA", "FIP", "WHIP", "K9", "BB9", "HR9", "TeamID"`)
      .eq("division", "NJCAA_D1")
      .eq("Season", SEASON)
      .gte("IP", 10)
      .range(pFrom, pFrom + 999);
    if (!data || data.length === 0) break;
    pitchers.push(...data);
    if (data.length < 1000) break;
    pFrom += 1000;
  }
  info(`Loaded ${pitchers.length} JUCO pitchers (IP>=10)`);

  // Aggregate per district
  const districtRows: any[] = [];
  for (const d of DISTRICTS) {
    const hs = hitters.filter((h: any) => teamDistrict.get(h.TeamID) === d.district);
    const ps = pitchers.filter((p: any) => teamDistrict.get(p.TeamID) === d.district);
    if (hs.length === 0) { warn(`No hitters for ${d.district} — skipping`); continue; }

    // PA-weighted hitter aggregates
    const totalPA = hs.reduce((s: number, h: any) => s + (h.pa ?? 0), 0);
    const avg = hs.reduce((s: number, h: any) => s + (h.AVG ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const obp = hs.reduce((s: number, h: any) => s + (h.OBP ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const iso = hs.reduce((s: number, h: any) => s + (h.ISO ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const slg = avg + iso;

    // PA-weighted hitter power ratings
    const baPR = hs.reduce((s: number, h: any) => s + (h.ba_power_rating ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const obpPR = hs.reduce((s: number, h: any) => s + (h.obp_power_rating ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const isoPR = hs.reduce((s: number, h: any) => s + (h.iso_power_rating ?? 0) * (h.pa ?? 0), 0) / totalPA;
    const overallPR = hs.reduce((s: number, h: any) => s + (h.overall_power_rating ?? 0) * (h.pa ?? 0), 0) / totalPA;

    // IP-weighted pitching aggregates
    const totalIP = ps.reduce((s: number, p: any) => s + (p.IP ?? 0), 0);
    const era = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.ERA ?? 0) * (p.IP ?? 0), 0) / totalIP : null;
    const fip = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.FIP ?? 0) * (p.IP ?? 0), 0) / totalIP : null;
    const whip = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.WHIP ?? 0) * (p.IP ?? 0), 0) / totalIP : null;
    const k9 = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.K9 ?? 0) * (p.IP ?? 0), 0) / totalIP : null;
    const bb9 = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.BB9 ?? 0) * (p.IP ?? 0), 0) / totalIP : null;
    const hr9 = totalIP > 0 ? ps.reduce((s: number, p: any) => s + (p.HR9 ?? 0) * (p.IP ?? 0), 0) / totalIP : null;

    // Team-weighted Stuff+ from LOCKED regional baselines (preserves overlays)
    let stuffTotal = 0, teamTotal = 0;
    for (const region of d.regions) {
      const baseline = REGIONAL_BASELINE_OVERLAY[region as keyof typeof REGIONAL_BASELINE_OVERLAY];
      const teams = d.teamCountByRegion[region] ?? 0;
      if (baseline && teams > 0) {
        stuffTotal += baseline.baseline * teams;
        teamTotal += teams;
      }
    }
    const stuffPlus = teamTotal > 0 ? Math.round((stuffTotal / teamTotal) * 10) / 10 : null;

    // env+ stats vs NCAA 2026
    const ba_plus = avg ? Math.round((avg / ncaa.avg) * 1000) / 10 : null;
    const obp_plus = obp ? Math.round((obp / ncaa.obp) * 1000) / 10 : null;
    const slg_plus = slg ? Math.round((slg / ncaa.slg) * 1000) / 10 : null;
    const iso_plus = iso ? Math.round((iso / ncaa.iso) * 1000) / 10 : null;

    const row = {
      "conference abbreviation": `NJCAA D1 ${d.district} District`,
      season: SEASON,
      "AVG": Math.round(avg * 1000) / 1000,
      "OBP": Math.round(obp * 1000) / 1000,
      "ISO": Math.round(iso * 1000) / 1000,
      ERA: era ? Math.round(era * 100) / 100 : null,
      FIP: fip ? Math.round(fip * 100) / 100 : null,
      WHIP: whip ? Math.round(whip * 100) / 100 : null,
      K9: k9 ? Math.round(k9 * 100) / 100 : null,
      BB9: bb9 ? Math.round(bb9 * 100) / 100 : null,
      HR9: hr9 ? Math.round(hr9 * 100) / 100 : null,
      Stuff_plus: stuffPlus,
      ba_power_rating: Math.round(baPR * 10) / 10,
      obp_power_rating: Math.round(obpPR * 10) / 10,
      iso_power_rating: Math.round(isoPR * 10) / 10,
      Overall_Power_Rating: Math.round(overallPR * 10) / 10,
      ba_plus, obp_plus, slg_plus, iso_plus,
    };
    info(`${d.district}: PA=${totalPA}, IP=${totalIP.toFixed(0)}, AVG=${row.AVG} (${ba_plus}+), Stuff+=${stuffPlus}`);
    districtRows.push(row);
  }

  if (!apply) { info("(dry-run — not writing)"); return; }
  if (districtRows.length === 0) { warn("No district rows to insert"); return; }

  // Re-runnable: preserve existing conference_id UUIDs (Hitter Master +
  // Pitching Master rows reference them), then delete+reinsert. If we
  // generated fresh UUIDs the district→player linkage would silently
  // break again — exactly the bug we hit yesterday with placeholder IDs.
  info("Looking up existing conference_id UUIDs to preserve linkage...");
  const { data: existing } = await staging
    .from("Conference Stats")
    .select(`"conference abbreviation", conference_id`)
    .ilike("conference abbreviation", "NJCAA D1%")
    .eq("season", SEASON);
  const idByAbbr = new Map<string, string>();
  for (const r of (existing || []) as any[]) {
    if (r.conference_id) idByAbbr.set(r["conference abbreviation"], r.conference_id);
  }
  info(`  Preserved ${idByAbbr.size} conference_id mappings`);
  for (const r of districtRows) {
    const cid = idByAbbr.get((r as any)["conference abbreviation"]);
    if (cid) (r as any).conference_id = cid;
    else warn(`  No existing conference_id for ${(r as any)["conference abbreviation"]} — will be null`);
  }

  info("Deleting existing JUCO district rows before re-insert...");
  const { error: delErr } = await staging
    .from("Conference Stats")
    .delete()
    .ilike("conference abbreviation", "NJCAA D1%")
    .eq("season", SEASON);
  if (delErr) { err(`Delete failed: ${delErr.message}`); throw delErr; }
  const { error } = await staging.from("Conference Stats").insert(districtRows);
  if (error) { err(`Insert failed: ${error.message}`); throw error; }
  ok(`Re-inserted ${districtRows.length} JUCO district rows with preserved conference_id`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(COLOR.bold + "\n══ Populate Conference Stats env+ + JUCO districts ══" + COLOR.reset);
  console.log(args.apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("slrxowawbijbjrkozqlj")) {
    err(`Expected staging URL. Got: ${url}`);
    process.exit(1);
  }
  const staging = createClient(url, key, { auth: { persistSession: false } });

  if (args.apply) await confirm();
  await populateD1EnvPlus(staging, args.apply);
  await populateJucoDistricts(staging, args.apply);
  console.log("\n" + (args.apply ? COLOR.green + "Done." : COLOR.cyan + "Dry-run complete. Re-run with --apply.") + COLOR.reset);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
