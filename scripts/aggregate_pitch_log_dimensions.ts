#!/usr/bin/env node
/**
 * Populate filter-dimension rows for pitch_log aggregations.
 *
 * Phase 3 + Phase 4 of the pitch log build (consolidated 2026-06-22).
 * Generates one row per (player, season, dimension_key) per applicable
 * aggregation table. Dimension 'all' uses an always-true predicate so
 * one script run covers the full Phase 3 baseline + Phase 4 splits.
 *
 * Each dimension produces 3 INSERT...SELECTs (one per table) keyed off
 * pitch_log filtered by a WHERE clause. The clauses differ between
 * pitcher- and hitter-side tables (e.g., vs_lhp = batter_hand='L' for
 * pitcher counts, pitcher_hand='L' for hitter counts).
 *
 * Mechanism: each INSERT is executed via the public.exec_sql RPC. No
 * transaction wrap → each statement auto-commits → gateway timeouts
 * don't roll back. Statements are idempotent via ON CONFLICT DO UPDATE.
 *
 * Prerequisite: public.exec_sql(sql text) must exist on the DB.
 *
 * Usage:
 *   npm run aggregate-pitch-log-dimensions -- --apply
 */
import { createClient } from "@supabase/supabase-js";

interface Dimension {
  key: string;
  // Filter expression applied to pitch_log when aggregating PITCHER tables.
  // null = dimension doesn't apply to pitchers (e.g. vs_92plus — useful for
  // hitters to gauge how they handle hard pitches; meaningless for
  // pitchers since most never throw 92+).
  pitcher_filter: string | null;
  // Filter expression applied to pitch_log when aggregating HITTER table.
  // null = doesn't apply to hitters (e.g. vs_top_hitters — about which
  // hitters a pitcher faces; meaningless for the hitter's own row).
  hitter_filter: string | null;
}

const DIMENSIONS: Dimension[] = [
  {
    // Baseline — every pitch counts, no filter. Idempotent re-run will
    // refresh the population already seeded by Phase 3. Use "true" as
    // an always-true SQL predicate.
    key: "all",
    pitcher_filter: "true",
    hitter_filter: "true",
  },
  {
    key: "vs_lhp",
    pitcher_filter: "batter_hand = 'L'",
    hitter_filter: "pitcher_hand = 'L'",
  },
  {
    key: "vs_rhp",
    pitcher_filter: "batter_hand = 'R'",
    hitter_filter: "pitcher_hand = 'R'",
  },
  {
    // Hitters only — pitches they SAW at 92+. Useful for "how does this
    // hitter handle harder velocity" splits. Replaces the original
    // vs_95plus (sample too small for pitchers + 92 is a more meaningful
    // D1 threshold).
    key: "vs_92plus",
    pitcher_filter: null,
    hitter_filter: "release_velocity >= 92",
  },
  {
    key: "vs_fastball",
    pitcher_filter: "pitch_type_reclassified IN ('4-Seam Fastball','Sinker','Cutter')",
    hitter_filter: "pitch_type_reclassified IN ('4-Seam Fastball','Sinker','Cutter')",
  },
  {
    key: "vs_breaking_ball",
    pitcher_filter: "pitch_type_reclassified IN ('Slider','Curveball','Gyro Slider','Sweeper')",
    hitter_filter: "pitch_type_reclassified IN ('Slider','Curveball','Gyro Slider','Sweeper')",
  },
  {
    key: "vs_offspeed",
    pitcher_filter: "pitch_type_reclassified IN ('Change-up','Splitter')",
    hitter_filter: "pitch_type_reclassified IN ('Change-up','Splitter')",
  },
  {
    // Pitchers only — pitches they threw against qualified top-quartile
    // hitters (Hitter Master season 2026, overall_power_rating >= 120.8,
    // pa >= 100). p75 cutoff derived on staging 2026-06-22.
    // overall_power_rating is RSTR IQ's stored hitter-talent composite
    // (100-scale, incorporates AVG/OBP/SLG/ISO + scouting subs).
    key: "vs_top_hitters",
    pitcher_filter: `batter_id IN (
      SELECT source_player_id FROM "Hitter Master"
      WHERE "Season" = 2026
        AND pa >= 100
        AND overall_power_rating IS NOT NULL
        AND overall_power_rating >= 120.8
    )`,
    hitter_filter: null,
  },
  {
    // Hitters only — individual pitches whose per-pitch Stuff+ score is
    // >= 100. Not the pitcher's season average — each pitch graded
    // individually. So a soft-tossing arm who hits 100 on one slider
    // still contributes that pitch to the slice.
    key: "vs_stuff_100plus",
    pitcher_filter: null,
    hitter_filter: "stuff_plus >= 100",
  },
  {
    // Hitters only — same per-pitch shape, narrower cutoff for elite pitches.
    key: "vs_stuff_105plus",
    pitcher_filter: null,
    hitter_filter: "stuff_plus >= 105",
  },
];

function pitcherTotalsSQL(dim: Dimension): string {
  return `
INSERT INTO public.pitch_log_pitcher_totals (
  pitcher_id, season, dimension_key,
  total_pitches, total_swings, total_takes,
  total_data_pitches, total_velo_pitches,
  total_in_zone, total_in_zone_swings, total_in_zone_whiffs,
  total_chases, total_whiffs, total_strikes, total_fouls, total_called_strikes,
  total_bf, total_pa, total_k, total_bb, total_hbp,
  stuff_plus_sum, stuff_plus_data_pitches
)
SELECT
  pitcher_id,
  season,
  '${dim.key}' AS dimension_key,
  COUNT(*) AS total_pitches,
  COUNT(*) FILTER (WHERE is_swing) AS total_swings,
  COUNT(*) FILTER (WHERE NOT is_swing) AS total_takes,
  COUNT(*) FILTER (WHERE is_data) AS total_data_pitches,
  COUNT(*) FILTER (WHERE has_velo) AS total_velo_pitches,
  COUNT(*) FILTER (WHERE is_in_zone) AS total_in_zone,
  COUNT(*) FILTER (WHERE is_in_zone AND is_swing) AS total_in_zone_swings,
  COUNT(*) FILTER (WHERE is_in_zone AND is_whiff) AS total_in_zone_whiffs,
  COUNT(*) FILTER (WHERE is_chase) AS total_chases,
  COUNT(*) FILTER (WHERE is_whiff) AS total_whiffs,
  COUNT(*) FILTER (WHERE is_strike) AS total_strikes,
  COUNT(*) FILTER (WHERE is_foul) AS total_fouls,
  COUNT(*) FILTER (WHERE pitch_result = 'Strike Looking') AS total_called_strikes,
  COUNT(*) FILTER (WHERE pitch_result_category NOT IN ('Ball','Strike','Foul','Other')) AS total_bf,
  COUNT(*) FILTER (WHERE pitch_result_category NOT IN ('Ball','Strike','Foul','Other')) AS total_pa,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Strikeout') AS total_k,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Walk') AS total_bb,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HBP') AS total_hbp,
  SUM(stuff_plus) AS stuff_plus_sum,
  COUNT(*) FILTER (WHERE stuff_plus IS NOT NULL) AS stuff_plus_data_pitches
FROM public.pitch_log
WHERE ${dim.pitcher_filter!}
GROUP BY pitcher_id, season
ON CONFLICT (pitcher_id, season, dimension_key) DO UPDATE SET
  total_pitches = EXCLUDED.total_pitches,
  total_swings = EXCLUDED.total_swings,
  total_takes = EXCLUDED.total_takes,
  total_data_pitches = EXCLUDED.total_data_pitches,
  total_velo_pitches = EXCLUDED.total_velo_pitches,
  total_in_zone = EXCLUDED.total_in_zone,
  total_in_zone_swings = EXCLUDED.total_in_zone_swings,
  total_in_zone_whiffs = EXCLUDED.total_in_zone_whiffs,
  total_chases = EXCLUDED.total_chases,
  total_whiffs = EXCLUDED.total_whiffs,
  total_strikes = EXCLUDED.total_strikes,
  total_fouls = EXCLUDED.total_fouls,
  total_called_strikes = EXCLUDED.total_called_strikes,
  total_bf = EXCLUDED.total_bf,
  total_pa = EXCLUDED.total_pa,
  total_k = EXCLUDED.total_k,
  total_bb = EXCLUDED.total_bb,
  total_hbp = EXCLUDED.total_hbp,
  stuff_plus_sum = EXCLUDED.stuff_plus_sum,
  stuff_plus_data_pitches = EXCLUDED.stuff_plus_data_pitches,
  computed_at = NOW();
`.trim();
}

function pitcherByPitchTypeSQL(dim: Dimension): string {
  return `
INSERT INTO public.pitch_log_pitcher_by_pitch_type (
  pitcher_id, season, pitch_type_reclassified, dimension_key,
  pitches, swings, whiffs, in_zone, in_zone_swings, in_zone_whiffs,
  chases, called_strikes,
  data_pitches, velo_pitches,
  stuff_plus_sum,
  velo_sum, ivb_sum, hb_sum, extension_sum, spin_sum, rel_height_sum, rel_side_sum
)
SELECT
  pitcher_id,
  season,
  pitch_type_reclassified,
  '${dim.key}' AS dimension_key,
  COUNT(*) AS pitches,
  COUNT(*) FILTER (WHERE is_swing) AS swings,
  COUNT(*) FILTER (WHERE is_whiff) AS whiffs,
  COUNT(*) FILTER (WHERE is_in_zone) AS in_zone,
  COUNT(*) FILTER (WHERE is_in_zone AND is_swing) AS in_zone_swings,
  COUNT(*) FILTER (WHERE is_in_zone AND is_whiff) AS in_zone_whiffs,
  COUNT(*) FILTER (WHERE is_chase) AS chases,
  COUNT(*) FILTER (WHERE pitch_result = 'Strike Looking') AS called_strikes,
  COUNT(*) FILTER (WHERE is_data) AS data_pitches,
  COUNT(*) FILTER (WHERE has_velo) AS velo_pitches,
  SUM(stuff_plus) AS stuff_plus_sum,
  SUM(release_velocity) AS velo_sum,
  SUM(ivb) AS ivb_sum,
  SUM(hb) AS hb_sum,
  SUM(extension) AS extension_sum,
  SUM(spin) AS spin_sum,
  SUM(rel_height) AS rel_height_sum,
  SUM(rel_side) AS rel_side_sum
FROM public.pitch_log
WHERE pitch_type_reclassified IS NOT NULL AND ${dim.pitcher_filter!}
GROUP BY pitcher_id, season, pitch_type_reclassified
ON CONFLICT (pitcher_id, season, pitch_type_reclassified, dimension_key) DO UPDATE SET
  pitches = EXCLUDED.pitches,
  swings = EXCLUDED.swings,
  whiffs = EXCLUDED.whiffs,
  in_zone = EXCLUDED.in_zone,
  in_zone_swings = EXCLUDED.in_zone_swings,
  in_zone_whiffs = EXCLUDED.in_zone_whiffs,
  chases = EXCLUDED.chases,
  called_strikes = EXCLUDED.called_strikes,
  data_pitches = EXCLUDED.data_pitches,
  velo_pitches = EXCLUDED.velo_pitches,
  stuff_plus_sum = EXCLUDED.stuff_plus_sum,
  velo_sum = EXCLUDED.velo_sum,
  ivb_sum = EXCLUDED.ivb_sum,
  hb_sum = EXCLUDED.hb_sum,
  extension_sum = EXCLUDED.extension_sum,
  spin_sum = EXCLUDED.spin_sum,
  rel_height_sum = EXCLUDED.rel_height_sum,
  rel_side_sum = EXCLUDED.rel_side_sum,
  computed_at = NOW();
`.trim();
}

function hitterByPitchTypeSQL(dim: Dimension): string {
  return `
INSERT INTO public.pitch_log_hitter_by_pitch_type (
  batter_id, season, pitch_type_reclassified, dimension_key,
  pa, ab, hits_single, hits_double, hits_triple, hits_hr,
  k, bb, hbp,
  pitches, swings, whiffs, chases,
  in_zone, in_zone_swings, in_zone_whiffs, fouls,
  batted_balls_in_play, batted_barrels, batted_hard_hit,
  ev_sum, batted_balls_with_ev
)
SELECT
  batter_id,
  season,
  pitch_type_reclassified,
  '${dim.key}' AS dimension_key,
  COUNT(*) FILTER (WHERE pitch_result_category NOT IN ('Ball','Strike','Foul','Other')) AS pa,
  COUNT(*) FILTER (WHERE pitch_result_category IN
    ('Strikeout','HR','Single','Double','Triple','GroundOut','FlyOut','LineOut','PopOut','Error','FieldersChoice','DoublePlay')) AS ab,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Single') AS hits_single,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Double') AS hits_double,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Triple') AS hits_triple,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HR') AS hits_hr,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Strikeout') AS k,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Walk') AS bb,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HBP') AS hbp,
  COUNT(*) AS pitches,
  COUNT(*) FILTER (WHERE is_swing) AS swings,
  COUNT(*) FILTER (WHERE is_whiff) AS whiffs,
  COUNT(*) FILTER (WHERE is_chase) AS chases,
  COUNT(*) FILTER (WHERE is_in_zone) AS in_zone,
  COUNT(*) FILTER (WHERE is_in_zone AND is_swing) AS in_zone_swings,
  COUNT(*) FILTER (WHERE is_in_zone AND is_whiff) AS in_zone_whiffs,
  COUNT(*) FILTER (WHERE is_foul) AS fouls,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play) AS batted_balls_in_play,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity >= 95 AND launch_angle >= 10 AND launch_angle < 35) AS batted_barrels,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity >= 95) AS batted_hard_hit,
  SUM(exit_velocity) FILTER (WHERE is_batted_ball_in_play AND exit_velocity IS NOT NULL) AS ev_sum,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity IS NOT NULL) AS batted_balls_with_ev
FROM public.pitch_log
WHERE pitch_type_reclassified IS NOT NULL AND ${dim.hitter_filter!}
GROUP BY batter_id, season, pitch_type_reclassified
ON CONFLICT (batter_id, season, pitch_type_reclassified, dimension_key) DO UPDATE SET
  pa = EXCLUDED.pa,
  ab = EXCLUDED.ab,
  hits_single = EXCLUDED.hits_single,
  hits_double = EXCLUDED.hits_double,
  hits_triple = EXCLUDED.hits_triple,
  hits_hr = EXCLUDED.hits_hr,
  k = EXCLUDED.k,
  bb = EXCLUDED.bb,
  hbp = EXCLUDED.hbp,
  pitches = EXCLUDED.pitches,
  swings = EXCLUDED.swings,
  whiffs = EXCLUDED.whiffs,
  chases = EXCLUDED.chases,
  in_zone = EXCLUDED.in_zone,
  in_zone_swings = EXCLUDED.in_zone_swings,
  in_zone_whiffs = EXCLUDED.in_zone_whiffs,
  fouls = EXCLUDED.fouls,
  batted_balls_in_play = EXCLUDED.batted_balls_in_play,
  batted_barrels = EXCLUDED.batted_barrels,
  batted_hard_hit = EXCLUDED.batted_hard_hit,
  ev_sum = EXCLUDED.ev_sum,
  batted_balls_with_ev = EXCLUDED.batted_balls_with_ev,
  computed_at = NOW();
`.trim();
}

function hitterTotalsSQL(dim: Dimension): string {
  return `
INSERT INTO public.pitch_log_hitter_totals (
  batter_id, season, dimension_key,
  pa, ab, hits_single, hits_double, hits_triple, hits_hr,
  k, bb, hbp, sac,
  total_pitches, total_swings, total_takes,
  total_data_pitches, total_velo_pitches,
  total_in_zone, total_in_zone_swings, total_in_zone_whiffs,
  total_chases, total_whiffs, total_fouls,
  batted_balls_in_play,
  batted_ground_balls, batted_line_drives, batted_fly_balls, batted_pop_ups,
  batted_barrels, batted_hard_hit, batted_la_10_to_30,
  ev_sum, batted_balls_with_ev
)
SELECT
  batter_id,
  season,
  '${dim.key}' AS dimension_key,
  COUNT(*) FILTER (WHERE pitch_result_category NOT IN ('Ball','Strike','Foul','Other')) AS pa,
  COUNT(*) FILTER (WHERE pitch_result_category IN
    ('Strikeout','HR','Single','Double','Triple','GroundOut','FlyOut','LineOut','PopOut','Error','FieldersChoice','DoublePlay')) AS ab,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Single') AS hits_single,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Double') AS hits_double,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Triple') AS hits_triple,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HR') AS hits_hr,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Strikeout') AS k,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Walk') AS bb,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HBP') AS hbp,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Sac') AS sac,
  COUNT(*) AS total_pitches,
  COUNT(*) FILTER (WHERE is_swing) AS total_swings,
  COUNT(*) FILTER (WHERE NOT is_swing) AS total_takes,
  COUNT(*) FILTER (WHERE is_data) AS total_data_pitches,
  COUNT(*) FILTER (WHERE has_velo) AS total_velo_pitches,
  COUNT(*) FILTER (WHERE is_in_zone) AS total_in_zone,
  COUNT(*) FILTER (WHERE is_in_zone AND is_swing) AS total_in_zone_swings,
  COUNT(*) FILTER (WHERE is_in_zone AND is_whiff) AS total_in_zone_whiffs,
  COUNT(*) FILTER (WHERE is_chase) AS total_chases,
  COUNT(*) FILTER (WHERE is_whiff) AS total_whiffs,
  COUNT(*) FILTER (WHERE is_foul) AS total_fouls,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play) AS batted_balls_in_play,
  -- LA category cutoffs (locked 2026-06-22): GB <5°, LD 5-20°, FB 20-50°, PU >=50°.
  -- TruMedia uses <5/5-20/20-55/>=55 — we deviate at the FB/PU boundary
  -- (capping PU at 50 instead of 55) to keep PU as a "true infield popup"
  -- bucket and not pull mid-arc fly balls into it.
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND launch_angle IS NOT NULL AND launch_angle < 5) AS batted_ground_balls,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND launch_angle >= 5 AND launch_angle < 20) AS batted_line_drives,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND launch_angle >= 20 AND launch_angle < 50) AS batted_fly_balls,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND launch_angle >= 50) AS batted_pop_ups,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity >= 95 AND launch_angle >= 10 AND launch_angle < 35) AS batted_barrels,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity >= 95) AS batted_hard_hit,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND launch_angle >= 10 AND launch_angle < 30) AS batted_la_10_to_30,
  SUM(exit_velocity) FILTER (WHERE is_batted_ball_in_play AND exit_velocity IS NOT NULL) AS ev_sum,
  COUNT(*) FILTER (WHERE is_batted_ball_in_play AND exit_velocity IS NOT NULL) AS batted_balls_with_ev
FROM public.pitch_log
WHERE ${dim.hitter_filter!}
GROUP BY batter_id, season
ON CONFLICT (batter_id, season, dimension_key) DO UPDATE SET
  pa = EXCLUDED.pa,
  ab = EXCLUDED.ab,
  hits_single = EXCLUDED.hits_single,
  hits_double = EXCLUDED.hits_double,
  hits_triple = EXCLUDED.hits_triple,
  hits_hr = EXCLUDED.hits_hr,
  k = EXCLUDED.k,
  bb = EXCLUDED.bb,
  hbp = EXCLUDED.hbp,
  sac = EXCLUDED.sac,
  total_pitches = EXCLUDED.total_pitches,
  total_swings = EXCLUDED.total_swings,
  total_takes = EXCLUDED.total_takes,
  total_data_pitches = EXCLUDED.total_data_pitches,
  total_velo_pitches = EXCLUDED.total_velo_pitches,
  total_in_zone = EXCLUDED.total_in_zone,
  total_in_zone_swings = EXCLUDED.total_in_zone_swings,
  total_in_zone_whiffs = EXCLUDED.total_in_zone_whiffs,
  total_chases = EXCLUDED.total_chases,
  total_whiffs = EXCLUDED.total_whiffs,
  total_fouls = EXCLUDED.total_fouls,
  batted_balls_in_play = EXCLUDED.batted_balls_in_play,
  batted_ground_balls = EXCLUDED.batted_ground_balls,
  batted_line_drives = EXCLUDED.batted_line_drives,
  batted_fly_balls = EXCLUDED.batted_fly_balls,
  batted_pop_ups = EXCLUDED.batted_pop_ups,
  batted_barrels = EXCLUDED.batted_barrels,
  batted_hard_hit = EXCLUDED.batted_hard_hit,
  batted_la_10_to_30 = EXCLUDED.batted_la_10_to_30,
  ev_sum = EXCLUDED.ev_sum,
  batted_balls_with_ev = EXCLUDED.batted_balls_with_ev,
  computed_at = NOW();
`.trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const tasks: Array<{ label: string; sql: string }> = [];
  for (const dim of DIMENSIONS) {
    if (dim.pitcher_filter) {
      tasks.push({ label: `${dim.key} → pitcher_totals`, sql: pitcherTotalsSQL(dim) });
      tasks.push({ label: `${dim.key} → pitcher_by_pitch_type`, sql: pitcherByPitchTypeSQL(dim) });
    }
    if (dim.hitter_filter) {
      tasks.push({ label: `${dim.key} → hitter_totals`, sql: hitterTotalsSQL(dim) });
      tasks.push({ label: `${dim.key} → hitter_by_pitch_type`, sql: hitterByPitchTypeSQL(dim) });
    }
  }

  console.log(`Total aggregations: ${tasks.length} across ${DIMENSIONS.length} dimensions`);

  if (!apply) {
    console.log("\n[dry-run] No writes. Re-run with --apply.");
    return;
  }

  const startTotal = process.hrtime.bigint();
  for (let i = 0; i < tasks.length; i++) {
    const { label, sql } = tasks[i];
    console.log(`\n[${i + 1}/${tasks.length}] ${label}`);
    const start = process.hrtime.bigint();
    const { error } = await (supabase as any).rpc("exec_sql", { sql });
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    if (error) {
      console.error(`  FAILED after ${sec.toFixed(1)}s: ${error.message}`);
      if (error.message?.includes("does not exist")) {
        console.error("\nThe exec_sql function must exist on the DB. Create it with:");
        console.error("CREATE OR REPLACE FUNCTION public.exec_sql(sql text)");
        console.error("RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$");
        console.error("BEGIN EXECUTE sql; END;");
        console.error("$$;");
      }
      process.exit(1);
    }
    console.log(`  ok (${sec.toFixed(1)}s)`);
  }
  const totalSec = Number(process.hrtime.bigint() - startTotal) / 1e9;
  console.log(`\nAll ${tasks.length} aggregations done in ${(totalSec / 60).toFixed(1)} min.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
