#!/usr/bin/env node
/**
 * Audit: compare scouting grades between Hitter Master (Overview source)
 * and pitch_log_hitter_totals 'all' dimension (Stats page source) for a
 * single player. Surfaces magnitude + likely cause of each metric delta.
 *
 * Usage:
 *   npm run audit-pitch-log-vs-master -- <source_player_id>
 *
 * For Aaron Piasecki:
 *   npm run audit-pitch-log-vs-master -- 1750930555
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Compact quantile-mapping lookups (copy of the production tables in
// src/savant/lib/pitchLogRates.ts — keep in sync after re-calibrations).
const LOOKUPS = {
  hitter_xba: [
    [0.0020, 0.0750], [0.1742, 0.2222], [0.2696, 0.2479], [0.3296, 0.2731],
    [0.3727, 0.2977], [0.4017, 0.3164], [0.4249, 0.3306], [0.4523, 0.3495],
    [0.4850, 0.3729], [0.5730, 0.4485],
  ],
  hitter_xslg: [
    [0.0026, 0.0980], [0.1454, 0.2771], [0.2857, 0.3301], [0.3735, 0.3627],
    [0.4226, 0.3860], [0.4734, 0.4188], [0.5158, 0.4472], [0.5604, 0.4800],
    [0.6103, 0.5153], [0.7367, 0.6045], [1.0967, 1.1569],
  ],
  pitcher_xba: [
    [0.0031, 0.1091], [0.1965, 0.2299], [0.2828, 0.2492], [0.3198, 0.2646],
    [0.3446, 0.2813], [0.3673, 0.2963], [0.3920, 0.3146], [0.4179, 0.3354],
    [0.4501, 0.3647], [0.4823, 0.4000], [0.6103, 0.4918],
  ],
  pitcher_xslg: [
    [0.0031, 0.1455], [0.1904, 0.3143], [0.3173, 0.3540], [0.4209, 0.3858],
    [0.4688, 0.4112], [0.5036, 0.4324], [0.5402, 0.4628], [0.5712, 0.4897],
    [0.6050, 0.5172], [0.6608, 0.5699], [0.8911, 0.9333],
  ],
} as const;

function interpQuant(x: number, name: keyof typeof LOOKUPS): number {
  const t = LOOKUPS[name];
  if (x <= t[0][0]) return t[0][1];
  if (x >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 0; i < t.length - 1; i++) {
    const [x0, y0] = t[i];
    const [x1, y1] = t[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return t[t.length - 1][1];
}

const sourcePlayerId = process.argv[2];
if (!sourcePlayerId) {
  console.error("Usage: npm run audit-pitch-log-vs-master -- <source_player_id>");
  process.exit(1);
}

const SEASON = 2026;

async function auditPitcher() {
  console.log("(PITCHER audit)\n");
  const { data: pm } = await (supabase as any)
    .from("Pitching Master")
    .select("*")
    .eq("source_player_id", sourcePlayerId)
    .eq("Season", SEASON)
    .maybeSingle();

  const { data: plt } = await (supabase as any)
    .from("pitch_log_pitcher_totals")
    .select("*")
    .eq("pitcher_id", sourcePlayerId)
    .eq("season", SEASON)
    .eq("dimension_key", "all")
    .maybeSingle();

  if (!pm || !plt) {
    console.log("Missing PM or pitch_log row.");
    return;
  }

  const { count: rawPitches } = await (supabase as any)
    .from("pitch_log")
    .select("*", { count: "exact", head: true })
    .eq("pitcher_id", sourcePlayerId)
    .eq("season", SEASON);

  console.log(`${pm.playerFullName} (${pm.Team} / ${pm.Conference})`);
  console.log(`pitch_log raw pitches thrown: ${rawPitches}\n`);

  const safeDiv = (n: number, d: number): number | null => (d > 0 ? n / d : null);

  // Derive pitch_log K9 / BB9 from raw counts + estimated IP.
  // IP estimate from BF: typical ~4.3 PA per inning.
  const estIp = plt.total_bf / 4.3;

  const pl = {
    bf: plt.total_bf,
    ip_est: estIp,
    k_count: plt.total_k,
    bb_count: plt.total_bb,
    k9: estIp > 0 ? (plt.total_k * 9) / estIp : null,
    bb9: estIp > 0 ? (plt.total_bb * 9) / estIp : null,
    whiff: safeDiv(plt.total_whiffs, plt.total_swings),
    chase: safeDiv(plt.total_chases, plt.total_pitches - plt.total_in_zone),
    iz_whiff: safeDiv(plt.total_in_zone_whiffs, plt.total_in_zone_swings),
    stuff: safeDiv(plt.stuff_plus_sum, plt.stuff_plus_data_pitches),
    hard_hit: safeDiv(plt.batted_hard_hit_allowed ?? 0, plt.batted_balls_allowed_in_play ?? 0),
    barrel: safeDiv(plt.batted_barrels_allowed ?? 0, plt.batted_balls_allowed_in_play ?? 0),
    avg_ev: safeDiv(plt.ev_sum_allowed ?? 0, plt.batted_balls_allowed_with_ev ?? 0),
    xba: (() => {
      const raw = safeDiv(plt.x_hits_sum_allowed ?? 0, plt.total_ab ?? 0);
      return raw === null ? null : interpQuant(raw, "pitcher_xba");
    })(),
    xslg: (() => {
      const raw = safeDiv(plt.x_bases_sum_allowed ?? 0, plt.total_ab ?? 0);
      return raw === null ? null : interpQuant(raw, "pitcher_xslg");
    })(),
    gb: safeDiv(plt.batted_ground_balls_allowed ?? 0, plt.batted_balls_allowed_in_play ?? 0),
    fb_velo: safeDiv(plt.fb_velo_sum ?? 0, plt.fb_velo_pitches ?? 0),
    xera: (() => {
      const W_BB = 0.696, W_HBP = 0.726;
      const num = (plt.x_woba_sum_allowed ?? 0) + W_BB * (plt.total_bb ?? 0) + W_HBP * (plt.total_hbp ?? 0);
      const den = (plt.total_ab ?? 0) + (plt.total_bb ?? 0) + (plt.total_hbp ?? 0);
      if (den <= 0) return null;
      const xwoba = num / den;
      return xwoba * (6.15 / 0.385);
    })(),
  };

  const fmtPct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const fmt1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
  const fmt2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  const hmPct = (v: any) => (v == null ? null : v / 100);

  console.log("METRIC          PITCHING MASTER (Overview)  PITCH LOG (Stats)        DELTA");
  console.log("─".repeat(90));

  const rows: [string, number | null, number | null, (v: number | null) => string][] = [
    ["IP", pm.IP, pl.ip_est, fmt2],
    ["BF (pitch_log)", null, pl.bf, (v) => (v === null ? "—" : `${v}`)],
    ["K count (PL)", null, pl.k_count, (v) => (v === null ? "—" : `${v}`)],
    ["BB count (PL)", null, pl.bb_count, (v) => (v === null ? "—" : `${v}`)],
    ["K/9", pm.K9, pl.k9, fmt2],
    ["BB/9", pm.BB9, pl.bb9, fmt2],
    ["BB%", hmPct(pm.bb_pct), safeDiv(plt.total_bb, plt.total_pa), fmtPct],
    ["Whiff% (miss_pct)", hmPct(pm.miss_pct), pl.whiff, fmtPct],
    ["Chase%", hmPct(pm.chase_pct), pl.chase, fmtPct],
    ["IZ Whiff%", hmPct(pm.in_zone_whiff_pct), pl.iz_whiff, fmtPct],
    ["Stuff+", pm.stuff_plus, pl.stuff, fmt1],
    ["Hard Hit% allowed", hmPct(pm.hard_hit_pct), pl.hard_hit, fmtPct],
    ["Barrel% allowed", hmPct(pm.barrel_pct), pl.barrel, fmtPct],
    ["Avg EV allowed", pm.exit_vel, pl.avg_ev, fmt1],
    ["GB% allowed", hmPct(pm.ground_pct), pl.gb, fmtPct],
    ["xBA-against", null, pl.xba, (v) => (v === null ? "—" : v.toFixed(3).replace(/^0+/, ""))],
    ["xSLG-against", null, pl.xslg, (v) => (v === null ? "—" : v.toFixed(3).replace(/^0+/, ""))],
    ["xERA", pm.ERA, pl.xera, fmt2],
    ["Avg FB Velo", null, pl.fb_velo, fmt1],
  ];

  for (const [label, pmVal, plVal, fmt] of rows) {
    const pmStr = fmt(pmVal).padEnd(12);
    const plStr = fmt(plVal).padEnd(12);
    let deltaStr = "—";
    if (pmVal !== null && plVal !== null) {
      const delta = plVal - pmVal;
      const pctDelta = Math.abs(pmVal) > 0.001 ? (delta / pmVal) * 100 : 0;
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(3)} (${pctDelta.toFixed(1)}%)`;
    } else if (plVal === null) {
      deltaStr = "(not aggregated for pitchers)";
    }
    console.log(`${label.padEnd(18)}${pmStr.padEnd(28)}${plStr.padEnd(25)}${deltaStr}`);
  }

  console.log("");
  console.log("Notes:");
  console.log("- IP estimate from BF / 4.3 (typical PA-per-inning ratio); may differ");
  console.log("  from PM's actual IP if pitcher faces unusual hit/walk rates.");
  console.log("- Hard Hit% / Barrel% / Avg EV / GB% allowed are NOT in");
  console.log("  pitch_log_pitcher_totals — we only aggregate them on the hitter side.");
  console.log("  Adding pitcher-side batted-ball aggregations is a real gap (see");
  console.log("  schema diff in audit doc).");
}

async function main() {
  console.log(`\n=== Audit for source_player_id=${sourcePlayerId}, season=${SEASON} ===\n`);

  // ── 0. Detect hitter vs pitcher ──────────────────────────────────
  const { data: hmTry } = await (supabase as any)
    .from("Hitter Master")
    .select("source_player_id")
    .eq("source_player_id", sourcePlayerId)
    .eq("Season", SEASON)
    .maybeSingle();
  const { data: pmTry } = await (supabase as any)
    .from("Pitching Master")
    .select("source_player_id")
    .eq("source_player_id", sourcePlayerId)
    .eq("Season", SEASON)
    .maybeSingle();

  if (pmTry && !hmTry) {
    return auditPitcher();
  }
  // If both exist (TWP), prefer hitter audit unless --pitcher flag given.
  if (pmTry && process.argv.includes("--pitcher")) {
    return auditPitcher();
  }

  // ── 1. Hitter Master row (Overview source) ────────────────────────
  const { data: hm } = await (supabase as any)
    .from("Hitter Master")
    .select("*")
    .eq("source_player_id", sourcePlayerId)
    .eq("Season", SEASON)
    .maybeSingle();

  if (!hm) {
    console.log("No Hitter Master row for this player in 2026.");
    return;
  }

  // ── 2. pitch_log_hitter_totals (Stats source) ─────────────────────
  const { data: plt } = await (supabase as any)
    .from("pitch_log_hitter_totals")
    .select("*")
    .eq("batter_id", sourcePlayerId)
    .eq("season", SEASON)
    .eq("dimension_key", "all")
    .maybeSingle();

  if (!plt) {
    console.log("No pitch_log_hitter_totals row for this player.");
    return;
  }

  // ── 3. Raw pitch_log volume + date range ──────────────────────────
  const { count: rawPitches } = await (supabase as any)
    .from("pitch_log")
    .select("*", { count: "exact", head: true })
    .eq("batter_id", sourcePlayerId)
    .eq("season", SEASON);

  const { data: dateRange } = await (supabase as any)
    .from("pitch_log")
    .select("date")
    .eq("batter_id", sourcePlayerId)
    .eq("season", SEASON)
    .order("date", { ascending: true })
    .limit(1);

  const { data: dateRangeEnd } = await (supabase as any)
    .from("pitch_log")
    .select("date")
    .eq("batter_id", sourcePlayerId)
    .eq("season", SEASON)
    .order("date", { ascending: false })
    .limit(1);

  const firstDate = dateRange?.[0]?.date?.substring(0, 10) ?? "?";
  const lastDate = dateRangeEnd?.[0]?.date?.substring(0, 10) ?? "?";

  console.log(`Hitter Master row: ${hm.playerFullName} (${hm.Team} / ${hm.Conference})`);
  console.log(`pitch_log raw pitches faced: ${rawPitches} (${firstDate} → ${lastDate})\n`);

  // ── 4. Derive pitch_log rates and compare to Hitter Master ────────
  const hits = plt.hits_single + plt.hits_double + plt.hits_triple + plt.hits_hr;
  const tb =
    plt.hits_single +
    2 * plt.hits_double +
    3 * plt.hits_triple +
    4 * plt.hits_hr;
  const safeDiv = (n: number, d: number): number | null =>
    d > 0 ? n / d : null;

  const pl = {
    pa: plt.pa,
    ab: plt.ab,
    avg: safeDiv(hits, plt.ab),
    obp: safeDiv(hits + plt.bb + plt.hbp, plt.ab + plt.bb + plt.hbp + plt.sac),
    slg: safeDiv(tb, plt.ab),
    iso:
      safeDiv(hits, plt.ab) !== null && safeDiv(tb, plt.ab) !== null
        ? safeDiv(tb, plt.ab)! - safeDiv(hits, plt.ab)!
        : null,
    contact:
      plt.total_swings > 0
        ? (plt.total_swings - plt.total_whiffs) / plt.total_swings
        : null,
    chase: safeDiv(plt.total_chases, plt.total_pitches - plt.total_in_zone),
    barrel: safeDiv(plt.batted_barrels, plt.batted_balls_in_play),
    hard_hit: safeDiv(plt.batted_hard_hit, plt.batted_balls_in_play),
    avg_ev: safeDiv(plt.ev_sum ?? 0, plt.batted_balls_with_ev),
    la_10_30: safeDiv(plt.batted_la_10_to_30, plt.batted_balls_in_play),
    gb: safeDiv(plt.batted_ground_balls, plt.batted_balls_in_play),
    ld: safeDiv(plt.batted_line_drives, plt.batted_balls_in_play),
    fb: safeDiv(plt.batted_fly_balls, plt.batted_balls_in_play),
    k_pct: safeDiv(plt.k, plt.pa),
    bb_pct: safeDiv(plt.bb, plt.pa),
    xba: (() => {
      const raw = safeDiv(plt.x_hits_sum ?? 0, plt.ab ?? 0);
      return raw === null ? null : interpQuant(raw, "hitter_xba");
    })(),
    xslg: (() => {
      const raw = safeDiv(plt.x_bases_sum ?? 0, plt.ab ?? 0);
      return raw === null ? null : interpQuant(raw, "hitter_xslg");
    })(),
  };

  const fmt3 = (v: number | null) =>
    v === null ? "—" : v.toFixed(3).replace(/^0+/, "");
  const fmtPct = (v: number | null) =>
    v === null ? "—" : `${(v * 100).toFixed(1)}%`;
  const fmt1 = (v: number | null) =>
    v === null ? "—" : v.toFixed(1);

  // Hitter Master scouting fields are stored as 0-100 (percentages).
  // Normalize to 0-1 for apples-to-apples display.
  const hmPct = (v: any) => (v == null ? null : v / 100);

  console.log("METRIC          HITTER MASTER (Overview)    PITCH LOG (Stats)        DELTA");
  console.log("─".repeat(90));

  const rows: [string, number | null, number | null, (v: number | null) => string][] = [
    ["PA", hm.pa, pl.pa, (v) => (v === null ? "—" : `${v}`)],
    ["AB", hm.ab, pl.ab, (v) => (v === null ? "—" : `${v}`)],
    ["AVG", hm.AVG, pl.avg, fmt3],
    ["OBP", hm.OBP, pl.obp, fmt3],
    ["SLG", hm.SLG, pl.slg, fmt3],
    ["ISO", hm.ISO, pl.iso, fmt3],
    ["Contact%", hmPct(hm.contact), pl.contact, fmtPct],
    ["Chase%", hmPct(hm.chase), pl.chase, fmtPct],
    ["Barrel%", hmPct(hm.barrel), pl.barrel, fmtPct],
    ["Avg EV", hm.avg_exit_velo, pl.avg_ev, fmt1],
    ["LA 10-30%", hmPct(hm.la_10_30), pl.la_10_30, fmtPct],
    ["GB%", hmPct(hm.gb), pl.gb, fmtPct],
    ["LD%", hmPct(hm.line_drive), pl.ld, fmtPct],
    ["K%", hmPct(hm.k_pct), pl.k_pct, fmtPct],
    ["BB%", hmPct(hm.bb), pl.bb_pct, fmtPct],
    ["xBA", null, pl.xba, fmt3],
    ["xSLG", null, pl.xslg, fmt3],
  ];

  for (const [label, hmVal, plVal, fmt] of rows) {
    const hmStr = fmt(hmVal).padEnd(12);
    const plStr = fmt(plVal).padEnd(12);
    let deltaStr = "—";
    if (hmVal !== null && plVal !== null) {
      const delta = plVal - hmVal;
      const pctDelta = Math.abs(hmVal) > 0.001 ? (delta / hmVal) * 100 : 0;
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(label.includes("%") ? 3 : 3)} (${pctDelta.toFixed(1)}%)`;
    }
    console.log(`${label.padEnd(16)}${hmStr.padEnd(28)}${plStr.padEnd(25)}${deltaStr}`);
  }

  console.log("");
  console.log("Notes:");
  console.log("- pitch_log includes the full ingested date range above.");
  console.log("- Hitter Master is a TruMedia season aggregate; postseason inclusion");
  console.log("  depends on when the import ran.");
  console.log("- Scouting rates (contact/chase/barrel/etc.) in Hitter Master are stored");
  console.log("  as 0-100 percentages; we divide by 100 for the comparison.");
  console.log("- AB/PA differences point to game-scope drift between sources.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
