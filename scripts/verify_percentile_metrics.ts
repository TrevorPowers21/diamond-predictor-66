#!/usr/bin/env node
/**
 * Verify the qualified-population distribution for every metric on the
 * percentile bars (both hitter + pitcher Stats pages). Spot-check known
 * players to make sure their percentile rank looks plausible.
 *
 * Reports league distribution (p10/p25/p50/p75/p90) for each metric and
 * the percentile rank of a few known reference players.
 *
 * Usage:
 *   npm run verify-percentile-metrics
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEASON = 2026;
const PITCHER_MIN_PITCHES = 100;
const HITTER_MIN_PA = 30;

const safeDiv = (n: number | null, d: number | null) =>
  n != null && d != null && d > 0 ? n / d : null;

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function rankIn(arr: number[], v: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  let below = 0;
  for (const x of sorted) if (x <= v) below++;
  return (below / sorted.length) * 100;
}

async function fetchAll(table: string, cols: string) {
  const out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(cols)
      .eq("season", SEASON)
      .eq("dimension_key", "all")
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function auditPitcher() {
  console.log("=== PITCHER metrics (qualified: total_pitches >= 100) ===\n");
  const all = await fetchAll(
    "pitch_log_pitcher_totals",
    "pitcher_id, total_pitches, total_swings, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_whiffs, total_called_strikes, total_strikes, total_pa, total_k, total_bb, stuff_plus_sum, stuff_plus_data_pitches, fb_velo_sum, fb_velo_pitches",
  );
  const qual = all.filter((r) => r.total_pitches >= PITCHER_MIN_PITCHES);
  console.log(`Qualified pop: ${qual.length}\n`);

  const metrics: Record<string, (r: any) => number | null> = {
    "Stuff+": (r) => safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches),
    "FB Velo": (r) => safeDiv(r.fb_velo_sum, r.fb_velo_pitches),
    "Whiff%": (r) => safeDiv(r.total_whiffs, r.total_swings),
    "IZ Whiff%": (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings),
    "Chase%": (r) => safeDiv(r.total_chases, r.total_out_of_zone),
    "CSW%": (r) => safeDiv(r.total_called_strikes + r.total_whiffs, r.total_pitches),
    "Strike%": (r) => safeDiv(r.total_strikes, r.total_pitches),
    "Zone%": (r) => safeDiv(r.total_in_zone, r.total_pitches),
    "K%": (r) => safeDiv(r.total_k, r.total_pa),
    "BB%": (r) => safeDiv(r.total_bb, r.total_pa),
  };

  const roblez = qual.find((r) => r.pitcher_id === "1180787200");
  console.log("Metric       | n       | p10      | p25      | p50      | p75      | p90      | Roblez (pct)");
  console.log("─".repeat(110));
  for (const [name, fn] of Object.entries(metrics)) {
    const vals = qual.map(fn).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    const fmt = (v: number) =>
      ["K%", "BB%", "Whiff%", "IZ Whiff%", "Chase%", "CSW%", "Strike%", "Zone%"].includes(name)
        ? `${(v * 100).toFixed(1)}%`.padStart(8)
        : v.toFixed(1).padStart(8);
    const roblezVal = roblez ? fn(roblez) : null;
    const roblezRank = roblezVal != null ? `${roblezVal.toFixed(roblezVal > 10 ? 1 : 3).replace(/^0+/, "")} (p${rankIn(vals, roblezVal).toFixed(0)})` : "—";
    console.log(
      `${name.padEnd(13)}| ${vals.length.toString().padStart(7)} | ${fmt(percentile(vals, 10))} | ${fmt(percentile(vals, 25))} | ${fmt(percentile(vals, 50))} | ${fmt(percentile(vals, 75))} | ${fmt(percentile(vals, 90))} | ${roblezRank}`,
    );
  }
}

async function auditHitter() {
  console.log("\n\n=== HITTER metrics (qualified: pa >= 30) ===\n");
  const all = await fetchAll(
    "pitch_log_hitter_totals",
    "batter_id, pa, ab, hits_single, hits_double, hits_triple, hits_hr, bb, hbp, sac, k, total_pitches, total_swings, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_whiffs, batted_balls_in_play, batted_barrels, batted_hard_hit, batted_ground_balls, batted_line_drives, batted_fly_balls, batted_la_10_to_30, ev_sum, batted_balls_with_ev, max_ev",
  );
  const qual = all.filter((r) => r.pa >= HITTER_MIN_PA);
  console.log(`Qualified pop: ${qual.length}\n`);

  const metrics: Record<string, (r: any) => number | null> = {
    "Contact%": (r) =>
      r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
    "Chase%": (r) => safeDiv(r.total_chases, r.total_out_of_zone),
    "IZ Whiff%": (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings),
    "Zone%": (r) => safeDiv(r.total_in_zone, r.total_pitches),
    "K%": (r) => safeDiv(r.k, r.pa),
    "BB%": (r) => safeDiv(r.bb, r.pa),
    "HR%": (r) => safeDiv(r.hits_hr, r.pa),
    "Avg EV": (r) => safeDiv(r.ev_sum, r.batted_balls_with_ev),
    "Max EV": (r) => r.max_ev,
    "Hard Hit%": (r) => safeDiv(r.batted_hard_hit, r.batted_balls_in_play),
    "Barrel%": (r) => safeDiv(r.batted_barrels, r.batted_balls_in_play),
    "LA 10-30%": (r) => safeDiv(r.batted_la_10_to_30, r.batted_balls_in_play),
    "GB%": (r) => safeDiv(r.batted_ground_balls, r.batted_balls_in_play),
    "LD%": (r) => safeDiv(r.batted_line_drives, r.batted_balls_in_play),
    "FB%": (r) => safeDiv(r.batted_fly_balls, r.batted_balls_in_play),
  };

  const piasecki = qual.find((r) => r.batter_id === "1750930555");
  console.log("Metric       | n       | p10      | p25      | p50      | p75      | p90      | Piasecki (pct)");
  console.log("─".repeat(110));
  for (const [name, fn] of Object.entries(metrics)) {
    const vals = qual.map(fn).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    const isPct = ["Contact%", "Chase%", "IZ Whiff%", "Zone%", "K%", "BB%", "HR%", "Hard Hit%", "Barrel%", "LA 10-30%", "GB%", "LD%", "FB%"].includes(name);
    const fmt = (v: number) =>
      isPct ? `${(v * 100).toFixed(1)}%`.padStart(8) : v.toFixed(1).padStart(8);
    const piaVal = piasecki ? fn(piasecki) : null;
    const piaRank = piaVal != null ? `${piaVal.toFixed(piaVal > 10 ? 1 : 3).replace(/^0+/, "")} (p${rankIn(vals, piaVal).toFixed(0)})` : "—";
    console.log(
      `${name.padEnd(13)}| ${vals.length.toString().padStart(7)} | ${fmt(percentile(vals, 10))} | ${fmt(percentile(vals, 25))} | ${fmt(percentile(vals, 50))} | ${fmt(percentile(vals, 75))} | ${fmt(percentile(vals, 90))} | ${piaRank}`,
    );
  }
}

async function main() {
  await auditPitcher();
  await auditHitter();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
