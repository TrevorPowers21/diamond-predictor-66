import { supabase } from "@/integrations/supabase/client";

// ─── Methodology ────────────────────────────────────────────────────────────
// 1. Per-conference rate aggregates (PA-weighted for hitters, IP-weighted for
//    pitchers) for every scouting metric.
// 2. Each rate is z-scored against the season's NCAA population mean + SD
//    (from ncaa_averages), then converted to a 0–100 percentile via normal CDF.
//    Lower-is-better metrics (Chase / Pop-up / Ground) are inverted.
// 3. Power Ratings derived from weighted combinations of those scores:
//    BA  = 0.40·Contact + 0.25·LD + 0.20·EV + 0.15·Popup
//    OBP = 0.35·Contact + 0.20·LD + 0.15·EV + 0.10·Popup + 0.15·BB + 0.05·Chase
//    ISO = 0.30·Barrel  + 0.25·EV90 + 0.20·Pull + 0.15·LA + 0.10·GB
// 4. Power Rating+ = (raw / 50) × 100  (50 = league-average score)
// 5. Offensive Power Rating+ = 0.15·BA+ + 0.40·OBP+ + 0.45·ISO+

// ─── Types ──────────────────────────────────────────────────────────────────

interface HitterRow {
  conference_id: string | null;
  Conference: string | null;
  pa: number | null;
  ab: number | null;
  contact: number | null;
  line_drive: number | null;
  avg_exit_velo: number | null;
  pop_up: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la_10_30: number | null;
  gb: number | null;
}

interface PitcherRow {
  conference_id: string | null;
  Conference: string | null;
  IP: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  line_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  in_zone_pct: number | null;
  h_pull_pct: number | null;
  la_10_30_pct: number | null;
  // 90th_vel is a quoted column
}

interface NcaaBaselines {
  contact_pct: number | null; contact_pct_sd: number | null;
  line_drive_pct: number | null; line_drive_pct_sd: number | null;
  exit_velo: number | null; exit_velo_sd: number | null;
  pop_up_pct: number | null; pop_up_pct_sd: number | null;
  bb_pct: number | null; bb_pct_sd: number | null;
  chase_pct: number | null; chase_pct_sd: number | null;
  barrel_pct: number | null; barrel_pct_sd: number | null;
  ev90: number | null; ev90_sd: number | null;
  pull_pct: number | null; pull_pct_sd: number | null;
  la_10_30_pct: number | null; la_10_30_pct_sd: number | null;
  ground_pct: number | null; ground_pct_sd: number | null;
  pitcher_whiff_pct: number | null; pitcher_whiff_pct_sd: number | null;
  pitcher_bb_pct: number | null; pitcher_bb_pct_sd: number | null;
  pitcher_hard_hit_pct: number | null; pitcher_hard_hit_pct_sd: number | null;
  pitcher_iz_whiff_pct: number | null; pitcher_iz_whiff_pct_sd: number | null;
  pitcher_chase_pct: number | null; pitcher_chase_pct_sd: number | null;
  pitcher_barrel_pct: number | null; pitcher_barrel_pct_sd: number | null;
  pitcher_line_drive_pct: number | null; pitcher_line_drive_pct_sd: number | null;
  pitcher_exit_velo: number | null; pitcher_exit_velo_sd: number | null;
  pitcher_ground_pct: number | null; pitcher_ground_pct_sd: number | null;
  pitcher_in_zone_pct: number | null; pitcher_in_zone_pct_sd: number | null;
  pitcher_ev90: number | null; pitcher_ev90_sd: number | null;
  pitcher_pull_pct: number | null; pitcher_pull_pct_sd: number | null;
  pitcher_la_10_30_pct: number | null; pitcher_la_10_30_pct_sd: number | null;
}

export interface ConfScoutingResult {
  conference_id: string;
  conference: string;
  hitterCount: number;
  totalPa: number;
  pitcherCount: number;
  totalIp: number;

  // Hitter raw rates (PA-weighted)
  hitter_contact_pct: number | null;
  hitter_line_drive_pct: number | null;
  hitter_avg_ev: number | null;
  hitter_pop_up_pct: number | null;
  hitter_bb_pct: number | null;
  hitter_chase_pct: number | null;
  hitter_barrel_pct: number | null;
  hitter_ev90: number | null;
  hitter_pull_pct: number | null;
  hitter_la_10_30_pct: number | null;
  hitter_gb_pct: number | null;

  // Pitcher raw rates (IP-weighted)
  pitcher_whiff_pct: number | null;
  pitcher_bb_pct: number | null;
  pitcher_hard_hit_pct: number | null;
  pitcher_iz_whiff_pct: number | null;
  pitcher_chase_pct: number | null;
  pitcher_barrel_pct: number | null;
  pitcher_line_drive_pct: number | null;
  pitcher_exit_velo: number | null;
  pitcher_ground_pct: number | null;
  pitcher_in_zone_pct: number | null;
  pitcher_ev90: number | null;
  pitcher_pull_pct: number | null;
  pitcher_la_10_30_pct: number | null;

  // Power Ratings
  ba_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  offensive_power_rating: number | null;

  // Hitter scores (0-100 percentiles)
  hitter_contact_score: number | null;
  hitter_line_drive_score: number | null;
  hitter_avg_ev_score: number | null;
  hitter_pop_up_score: number | null;
  hitter_bb_score: number | null;
  hitter_chase_score: number | null;
  hitter_barrel_score: number | null;
  hitter_ev90_score: number | null;
  hitter_pull_score: number | null;
  hitter_la_score: number | null;
  hitter_gb_score: number | null;

  // Pitcher scores (0-100 percentiles)
  pitcher_whiff_score: number | null;
  pitcher_bb_score: number | null;
  pitcher_hh_score: number | null;
  pitcher_iz_whiff_score: number | null;
  pitcher_chase_score: number | null;
  pitcher_barrel_score: number | null;
  pitcher_ld_score: number | null;
  pitcher_ev_score: number | null;
  pitcher_gb_score: number | null;
  pitcher_iz_score: number | null;
  pitcher_ev90_score: number | null;
  pitcher_pull_score: number | null;
  pitcher_la_score: number | null;
}

export interface ConferenceScoutingReport {
  results: ConfScoutingResult[];
  written: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchAll<T>(table: string, select: string, season: number): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(select)
      .eq("Season", season)
      .order("source_player_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function weightedMean(rows: Array<{ value: number | null; weight: number }>): number | null {
  let sumV = 0;
  let sumW = 0;
  for (const r of rows) {
    if (r.value == null || !Number.isFinite(r.value) || r.weight <= 0) continue;
    sumV += r.value * r.weight;
    sumW += r.weight;
  }
  return sumW > 0 ? sumV / sumW : null;
}

// Normal CDF approximation (Abramowitz & Stegun 7.1.26 → percentile 0..100)
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
}

// Score a rate against pop mean/SD → 0-100 percentile (inverted if lowerBetter)
function scoreRate(
  rate: number | null,
  popMean: number | null,
  popSd: number | null,
  lowerBetter = false,
): number | null {
  if (rate == null || popMean == null || popSd == null || popSd <= 0) return null;
  const z = (rate - popMean) / popSd;
  const pct = normalCdf(z) * 100;
  return lowerBetter ? 100 - pct : pct;
}

const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function computeConferenceScoutingAverages(
  season: number,
): Promise<{ report: ConferenceScoutingReport; errors: string[] }> {
  const errors: string[] = [];
  console.time("[ConfScout] TOTAL");

  // ── 1. Pull NCAA baselines ────────────────────────────────────────────
  console.time("[ConfScout] 1. fetch baselines");
  const { data: baselineData, error: blErr } = await (supabase as any)
    .from("ncaa_averages")
    .select("*")
    .eq("season", season)
    .maybeSingle();
  if (blErr || !baselineData) {
    errors.push(`No NCAA baselines for season ${season} — run Compute NCAA Averages first`);
    console.timeEnd("[ConfScout] 1. fetch baselines");
    console.timeEnd("[ConfScout] TOTAL");
    return { report: { results: [], written: 0 }, errors };
  }
  const baselines = baselineData as NcaaBaselines;
  console.timeEnd("[ConfScout] 1. fetch baselines");

  // ── 2. Pull hitters with raw rates + PA + conference_id ───────────────
  console.time("[ConfScout] 2. fetch hitters");
  const hitters = await fetchAll<HitterRow>(
    "Hitter Master",
    `conference_id, Conference, pa, ab,
     contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90,
     pull, la_10_30, gb,
     source_player_id`,
    season,
  );
  console.timeEnd("[ConfScout] 2. fetch hitters");

  // ── 3. Pull pitchers with raw rates + IP + conference_id ──────────────
  console.time("[ConfScout] 3. fetch pitchers");
  const pitchers = await fetchAll<PitcherRow & { "90th_vel": number | null }>(
    "Pitching Master",
    `conference_id, Conference, "IP",
     miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct,
     barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct,
     h_pull_pct, la_10_30_pct, "90th_vel",
     source_player_id`,
    season,
  );
  console.timeEnd("[ConfScout] 3. fetch pitchers");

  // ── 4. Group + aggregate by conference_id ─────────────────────────────
  console.time("[ConfScout] 4. aggregate");
  const hitterByConfId = new Map<string, HitterRow[]>();
  const labelByConfId = new Map<string, string>();
  for (const h of hitters) {
    const cid = h.conference_id;
    if (!cid) continue;
    if (!hitterByConfId.has(cid)) hitterByConfId.set(cid, []);
    hitterByConfId.get(cid)!.push(h);
    if (h.Conference && !labelByConfId.has(cid)) labelByConfId.set(cid, h.Conference);
  }
  const pitcherByConfId = new Map<string, Array<PitcherRow & { "90th_vel": number | null }>>();
  for (const p of pitchers) {
    const cid = p.conference_id;
    if (!cid) continue;
    if (!pitcherByConfId.has(cid)) pitcherByConfId.set(cid, []);
    pitcherByConfId.get(cid)!.push(p);
    if (p.Conference && !labelByConfId.has(cid)) labelByConfId.set(cid, p.Conference);
  }

  const allConfIds = new Set([...hitterByConfId.keys(), ...pitcherByConfId.keys()]);
  const results: ConfScoutingResult[] = [];

  for (const cid of allConfIds) {
    const hRows = hitterByConfId.get(cid) ?? [];
    const pRows = pitcherByConfId.get(cid) ?? [];

    // Hitter PA weight (AB fallback)
    const hWeight = (h: HitterRow) => {
      const pa = Number(h.pa);
      const ab = Number(h.ab);
      return Number.isFinite(pa) && pa > 0 ? pa : Number.isFinite(ab) && ab > 0 ? ab : 0;
    };
    const wMeanH = (key: keyof HitterRow) =>
      weightedMean(hRows.map((h) => ({ value: Number(h[key]), weight: hWeight(h) })));

    // Conference-level hitter rates
    const confContact = wMeanH("contact");
    const confLD = wMeanH("line_drive");
    const confEV = wMeanH("avg_exit_velo");
    const confPopup = wMeanH("pop_up");
    const confBB = wMeanH("bb");
    const confChase = wMeanH("chase");
    const confBarrel = wMeanH("barrel");
    const confEV90 = wMeanH("ev90");
    const confPull = wMeanH("pull");
    const confLA = wMeanH("la_10_30");
    const confGB = wMeanH("gb");

    // Score each hitter rate
    const sContact = scoreRate(confContact, baselines.contact_pct, baselines.contact_pct_sd);
    const sLD = scoreRate(confLD, baselines.line_drive_pct, baselines.line_drive_pct_sd);
    const sEV = scoreRate(confEV, baselines.exit_velo, baselines.exit_velo_sd);
    const sPopup = scoreRate(confPopup, baselines.pop_up_pct, baselines.pop_up_pct_sd, true); // lower-better
    const sBB = scoreRate(confBB, baselines.bb_pct, baselines.bb_pct_sd);
    const sChase = scoreRate(confChase, baselines.chase_pct, baselines.chase_pct_sd, true); // lower-better
    const sBarrel = scoreRate(confBarrel, baselines.barrel_pct, baselines.barrel_pct_sd);
    const sEV90 = scoreRate(confEV90, baselines.ev90, baselines.ev90_sd);
    const sPull = scoreRate(confPull, baselines.pull_pct, baselines.pull_pct_sd);
    const sLA = scoreRate(confLA, baselines.la_10_30_pct, baselines.la_10_30_pct_sd);
    const sGB = scoreRate(confGB, baselines.ground_pct, baselines.ground_pct_sd, true); // lower-better

    // Power Rating raw composites
    const baRaw =
      sContact != null && sLD != null && sEV != null && sPopup != null
        ? 0.4 * sContact + 0.25 * sLD + 0.2 * sEV + 0.15 * sPopup
        : null;
    const obpRaw =
      sContact != null && sLD != null && sEV != null && sPopup != null && sBB != null && sChase != null
        ? 0.35 * sContact + 0.2 * sLD + 0.15 * sEV + 0.1 * sPopup + 0.15 * sBB + 0.05 * sChase
        : null;
    const isoRaw =
      sBarrel != null && sEV90 != null && sPull != null && sLA != null && sGB != null
        ? 0.3 * sBarrel + 0.25 * sEV90 + 0.2 * sPull + 0.15 * sLA + 0.1 * sGB
        : null;

    // Power Rating+ = (raw / 50) × 100
    const baPlus = baRaw == null ? null : (baRaw / 50) * 100;
    const obpPlus = obpRaw == null ? null : (obpRaw / 50) * 100;
    const isoPlus = isoRaw == null ? null : (isoRaw / 50) * 100;
    const offensivePR =
      baPlus != null && obpPlus != null && isoPlus != null
        ? 0.15 * baPlus + 0.4 * obpPlus + 0.45 * isoPlus
        : null;

    const totalPa = hRows.reduce((s, h) => s + hWeight(h), 0);

    // Pitcher side — same approach, IP-weighted
    const pWeight = (p: PitcherRow) => {
      const ip = Number(p.IP);
      return Number.isFinite(ip) && ip > 0 ? ip : 0;
    };
    const wMeanP = (key: keyof (PitcherRow & { "90th_vel": number | null })) =>
      weightedMean(pRows.map((p) => ({ value: Number((p as any)[key]), weight: pWeight(p) })));

    const confPMiss = wMeanP("miss_pct");
    const confPBB = wMeanP("bb_pct");
    const confPHH = wMeanP("hard_hit_pct");
    const confPIZWhiff = wMeanP("in_zone_whiff_pct");
    const confPChase = wMeanP("chase_pct");
    const confPBarrel = wMeanP("barrel_pct");
    const confPLD = wMeanP("line_pct");
    const confPEV = wMeanP("exit_vel");
    const confPGB = wMeanP("ground_pct");
    const confPIZ = wMeanP("in_zone_pct");
    const confP90thVel = wMeanP("90th_vel");
    const confPPull = wMeanP("h_pull_pct");
    const confPLA = wMeanP("la_10_30_pct");

    // Score each pitcher rate (whiff, IZ whiff = higher-better; BB/HH/Barrel/LD/EV/Pull/LA = lower-better
    // for hitter outcomes which means higher-better for pitcher; chase/in-zone = higher-better; GB = higher-better)
    const psWhiff = scoreRate(confPMiss, baselines.pitcher_whiff_pct, baselines.pitcher_whiff_pct_sd);
    const psBB = scoreRate(confPBB, baselines.pitcher_bb_pct, baselines.pitcher_bb_pct_sd, true); // lower BB = better
    const psHH = scoreRate(confPHH, baselines.pitcher_hard_hit_pct, baselines.pitcher_hard_hit_pct_sd, true);
    const psIZWhiff = scoreRate(confPIZWhiff, baselines.pitcher_iz_whiff_pct, baselines.pitcher_iz_whiff_pct_sd);
    const psChase = scoreRate(confPChase, baselines.pitcher_chase_pct, baselines.pitcher_chase_pct_sd);
    const psBarrel = scoreRate(confPBarrel, baselines.pitcher_barrel_pct, baselines.pitcher_barrel_pct_sd, true);
    const psLD = scoreRate(confPLD, baselines.pitcher_line_drive_pct, baselines.pitcher_line_drive_pct_sd, true);
    const psEV = scoreRate(confPEV, baselines.pitcher_exit_velo, baselines.pitcher_exit_velo_sd, true);
    const psGB = scoreRate(confPGB, baselines.pitcher_ground_pct, baselines.pitcher_ground_pct_sd);
    const psIZ = scoreRate(confPIZ, baselines.pitcher_in_zone_pct, baselines.pitcher_in_zone_pct_sd);
    const psEV90 = scoreRate(confP90thVel, baselines.pitcher_ev90, baselines.pitcher_ev90_sd, true); // pitcher allows lower 90th = better
    const psPull = scoreRate(confPPull, baselines.pitcher_pull_pct, baselines.pitcher_pull_pct_sd, true);
    const psLA = scoreRate(confPLA, baselines.pitcher_la_10_30_pct, baselines.pitcher_la_10_30_pct_sd, true);

    const totalIp = pRows.reduce((s, p) => s + pWeight(p), 0);

    const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

    results.push({
      conference_id: cid,
      conference: labelByConfId.get(cid) ?? cid,
      hitterCount: hRows.length,
      totalPa,
      pitcherCount: pRows.length,
      totalIp,

      // Hitter raw rates
      hitter_contact_pct: round2(confContact),
      hitter_line_drive_pct: round2(confLD),
      hitter_avg_ev: round2(confEV),
      hitter_pop_up_pct: round2(confPopup),
      hitter_bb_pct: round2(confBB),
      hitter_chase_pct: round2(confChase),
      hitter_barrel_pct: round2(confBarrel),
      hitter_ev90: round2(confEV90),
      hitter_pull_pct: round2(confPull),
      hitter_la_10_30_pct: round2(confLA),
      hitter_gb_pct: round2(confGB),

      // Pitcher raw rates
      pitcher_whiff_pct: round2(confPMiss),
      pitcher_bb_pct: round2(confPBB),
      pitcher_hard_hit_pct: round2(confPHH),
      pitcher_iz_whiff_pct: round2(confPIZWhiff),
      pitcher_chase_pct: round2(confPChase),
      pitcher_barrel_pct: round2(confPBarrel),
      pitcher_line_drive_pct: round2(confPLD),
      pitcher_exit_velo: round2(confPEV),
      pitcher_ground_pct: round2(confPGB),
      pitcher_in_zone_pct: round2(confPIZ),
      pitcher_ev90: round2(confP90thVel),
      pitcher_pull_pct: round2(confPPull),
      pitcher_la_10_30_pct: round2(confPLA),

      ba_plus: round1(baPlus),
      obp_plus: round1(obpPlus),
      iso_plus: round1(isoPlus),
      offensive_power_rating: round1(offensivePR),

      hitter_contact_score: round1(sContact),
      hitter_line_drive_score: round1(sLD),
      hitter_avg_ev_score: round1(sEV),
      hitter_pop_up_score: round1(sPopup),
      hitter_bb_score: round1(sBB),
      hitter_chase_score: round1(sChase),
      hitter_barrel_score: round1(sBarrel),
      hitter_ev90_score: round1(sEV90),
      hitter_pull_score: round1(sPull),
      hitter_la_score: round1(sLA),
      hitter_gb_score: round1(sGB),

      pitcher_whiff_score: round1(psWhiff),
      pitcher_bb_score: round1(psBB),
      pitcher_hh_score: round1(psHH),
      pitcher_iz_whiff_score: round1(psIZWhiff),
      pitcher_chase_score: round1(psChase),
      pitcher_barrel_score: round1(psBarrel),
      pitcher_ld_score: round1(psLD),
      pitcher_ev_score: round1(psEV),
      pitcher_gb_score: round1(psGB),
      pitcher_iz_score: round1(psIZ),
      pitcher_ev90_score: round1(psEV90),
      pitcher_pull_score: round1(psPull),
      pitcher_la_score: round1(psLA),
    });
  }

  results.sort((a, b) => (b.offensive_power_rating ?? 0) - (a.offensive_power_rating ?? 0));
  console.timeEnd("[ConfScout] 4. aggregate");

  // ── 5. Write to Conference Stats ──────────────────────────────────────
  console.time("[ConfScout] 5. write");
  let written = 0;
  for (const r of results) {
    const payload: Record<string, any> = {
      // Power Ratings
      ba_plus: r.ba_plus,
      obp_plus: r.obp_plus,
      iso_plus: r.iso_plus,
      offensive_power_rating: r.offensive_power_rating,
      // Hitter raw rates
      hitter_contact_pct: r.hitter_contact_pct,
      hitter_line_drive_pct: r.hitter_line_drive_pct,
      hitter_avg_ev: r.hitter_avg_ev,
      hitter_pop_up_pct: r.hitter_pop_up_pct,
      hitter_bb_pct: r.hitter_bb_pct,
      hitter_chase_pct: r.hitter_chase_pct,
      hitter_barrel_pct: r.hitter_barrel_pct,
      hitter_ev90: r.hitter_ev90,
      hitter_pull_pct: r.hitter_pull_pct,
      hitter_la_10_30_pct: r.hitter_la_10_30_pct,
      hitter_gb_pct: r.hitter_gb_pct,
      // Pitcher raw rates
      pitcher_whiff_pct: r.pitcher_whiff_pct,
      pitcher_bb_pct: r.pitcher_bb_pct,
      pitcher_hard_hit_pct: r.pitcher_hard_hit_pct,
      pitcher_iz_whiff_pct: r.pitcher_iz_whiff_pct,
      pitcher_chase_pct: r.pitcher_chase_pct,
      pitcher_barrel_pct: r.pitcher_barrel_pct,
      pitcher_line_drive_pct: r.pitcher_line_drive_pct,
      pitcher_exit_velo: r.pitcher_exit_velo,
      pitcher_ground_pct: r.pitcher_ground_pct,
      pitcher_in_zone_pct: r.pitcher_in_zone_pct,
      pitcher_ev90: r.pitcher_ev90,
      pitcher_pull_pct: r.pitcher_pull_pct,
      pitcher_la_10_30_pct: r.pitcher_la_10_30_pct,
      // Hitter scores (0-100 percentiles)
      hitter_contact_score: r.hitter_contact_score,
      hitter_line_drive_score: r.hitter_line_drive_score,
      hitter_avg_ev_score: r.hitter_avg_ev_score,
      hitter_pop_up_score: r.hitter_pop_up_score,
      hitter_bb_score: r.hitter_bb_score,
      hitter_chase_score: r.hitter_chase_score,
      hitter_barrel_score: r.hitter_barrel_score,
      hitter_ev90_score: r.hitter_ev90_score,
      hitter_pull_score: r.hitter_pull_score,
      hitter_la_score: r.hitter_la_score,
      hitter_gb_score: r.hitter_gb_score,
      pitcher_whiff_score: r.pitcher_whiff_score,
      pitcher_bb_score: r.pitcher_bb_score,
      pitcher_hh_score: r.pitcher_hh_score,
      pitcher_iz_whiff_score: r.pitcher_iz_whiff_score,
      pitcher_chase_score: r.pitcher_chase_score,
      pitcher_barrel_score: r.pitcher_barrel_score,
      pitcher_ld_score: r.pitcher_ld_score,
      pitcher_ev_score: r.pitcher_ev_score,
      pitcher_gb_score: r.pitcher_gb_score,
      pitcher_iz_score: r.pitcher_iz_score,
      pitcher_ev90_score: r.pitcher_ev90_score,
      pitcher_pull_score: r.pitcher_pull_score,
      pitcher_la_score: r.pitcher_la_score,
    };
    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update(payload)
      .eq("conference_id", r.conference_id)
      .eq("season", season);
    if (error) errors.push(`Update ${r.conference}: ${error.message}`);
    else written++;
  }
  console.timeEnd("[ConfScout] 5. write");
  console.timeEnd("[ConfScout] TOTAL");

  return { report: { results, written }, errors };
}
