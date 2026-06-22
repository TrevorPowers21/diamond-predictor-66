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

const sourcePlayerId = process.argv[2];
if (!sourcePlayerId) {
  console.error("Usage: npm run audit-pitch-log-vs-master -- <source_player_id>");
  process.exit(1);
}

const SEASON = 2026;

async function main() {
  console.log(`\n=== Audit for source_player_id=${sourcePlayerId}, season=${SEASON} ===\n`);

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
