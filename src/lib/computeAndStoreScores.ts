import { supabase } from "@/integrations/supabase/client";
import { computeHitterPowerRatings, computePitchingPowerRatings } from "@/lib/powerRatings";

const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/**
 * Compute and store all hitter power rating scores for a given season.
 * Reads raw sub-metrics from Hitter Master, computes scores, writes back.
 */
export async function computeAndStoreHitterScores(season = 2025): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  let from = 0;
  const pageSize = 500;

  while (true) {
    const { data: rows, error } = await supabase
      .from("Hitter Master")
      .select("id, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb")
      .eq("Season", season)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const ratings = computeHitterPowerRatings({
        contact: row.contact,
        lineDrive: row.line_drive,
        avgExitVelo: row.avg_exit_velo,
        popUp: row.pop_up,
        bb: row.bb,
        chase: row.chase,
        barrel: row.barrel,
        ev90: row.ev90,
        pull: row.pull,
        la10_30: row.la_10_30,
        gb: row.gb,
      });

      const { error: updateErr } = await supabase
        .from("Hitter Master")
        .update({
          contact_score: round2(ratings.contactScore),
          line_drive_score: round2(ratings.lineDriveScore),
          avg_ev_score: round2(ratings.avgEVScore),
          pop_up_score: round2(ratings.popUpScore),
          bb_score: round2(ratings.bbScore),
          chase_score: round2(ratings.chaseScore),
          barrel_score: round2(ratings.barrelScore),
          ev90_score: round2(ratings.ev90Score),
          pull_score: round2(ratings.pullScore),
          la_score: round2(ratings.laScore),
          gb_score: round2(ratings.gbScore),
          ba_plus: round2(ratings.baPlus),
          obp_plus: round2(ratings.obpPlus),
          iso_plus: round2(ratings.isoPlus),
          overall_plus: round2(ratings.overallPlus),
        })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`Failed to update hitter ${row.id}:`, updateErr);
        errors++;
      } else {
        updated++;
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return { updated, errors };
}

/**
 * Compute and store all pitching power rating scores for a given season.
 * Reads raw sub-metrics from Pitching Master, computes scores, writes back.
 */
export async function computeAndStorePitchingScores(season = 2025): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;
  let from = 0;
  const pageSize = 500;

  while (true) {
    const { data: rows, error } = await supabase
      .from("Pitching Master")
      .select("id, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct, \"90th_vel\", h_pull_pct, la_10_30_pct, stuff_plus")
      .eq("Season", season)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const ratings = computePitchingPowerRatings({
        miss_pct: row.miss_pct,
        bb_pct: row.bb_pct,
        hard_hit_pct: row.hard_hit_pct,
        in_zone_whiff_pct: row.in_zone_whiff_pct,
        chase_pct: row.chase_pct,
        barrel_pct: row.barrel_pct,
        line_pct: row.line_pct,
        exit_vel: row.exit_vel,
        ground_pct: row.ground_pct,
        in_zone_pct: row.in_zone_pct,
        vel_90th: (row as any)["90th_vel"],
        h_pull_pct: row.h_pull_pct,
        la_10_30_pct: row.la_10_30_pct,
      }, (row as any).stuff_plus ?? null);

      const { error: updateErr } = await supabase
        .from("Pitching Master")
        .update({
          whiff_score: round2(ratings.whiffScore),
          bb_score: round2(ratings.bbScore),
          hh_score: round2(ratings.hhScore),
          iz_whiff_score: round2(ratings.izWhiffScore),
          chase_score: round2(ratings.chaseScore),
          barrel_score: round2(ratings.barrelScore),
          ld_score: round2(ratings.ldScore),
          ev_score: round2(ratings.evScore),
          gb_score: round2(ratings.gbScore),
          iz_score: round2(ratings.izScore),
          ev90_score: round2(ratings.ev90Score),
          pull_score: round2(ratings.pullScore),
          la_score: round2(ratings.laScore),
          era_pr_plus: round2(ratings.eraPrPlus),
          fip_pr_plus: round2(ratings.fipPrPlus),
          whip_pr_plus: round2(ratings.whipPrPlus),
          k9_pr_plus: round2(ratings.k9PrPlus),
          bb9_pr_plus: round2(ratings.bb9PrPlus),
          hr9_pr_plus: round2(ratings.hr9PrPlus),
          overall_pr_plus: round2(ratings.overallPrPlus),
        })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`Failed to update pitcher ${row.id}:`, updateErr);
        errors++;
      } else {
        updated++;
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return { updated, errors };
}

/** Run both hitter and pitcher score computations */
export async function computeAndStoreAllScores(season = 2025) {
  const hitters = await computeAndStoreHitterScores(season);
  const pitchers = await computeAndStorePitchingScores(season);
  return { hitters, pitchers };
}

// ─── Auto-detect & compute unscored rows ───────────────────────────────

let _autoComputeRunning = false;

/** Check if any hitters/pitchers for a season are missing scores, and compute them if so */
export async function autoComputeUnscoredRows(season = 2025): Promise<void> {
  if (_autoComputeRunning) return;
  _autoComputeRunning = true;
  try {
    // Check for unscored hitters
    const { count: unscoredHitters } = await supabase
      .from("Hitter Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("ba_plus", null);

    if (unscoredHitters && unscoredHitters > 0) {
      console.log(`[autoCompute] Found ${unscoredHitters} unscored hitters for ${season}, computing...`);
      const result = await computeAndStoreHitterScores(season);
      console.log(`[autoCompute] Hitters done: ${result.updated} updated, ${result.errors} errors`);
    }

    // Check for unscored pitchers
    const { count: unscoredPitchers } = await supabase
      .from("Pitching Master")
      .select("id", { count: "exact", head: true })
      .eq("Season", season)
      .is("era_pr_plus", null);

    if (unscoredPitchers && unscoredPitchers > 0) {
      console.log(`[autoCompute] Found ${unscoredPitchers} unscored pitchers for ${season}, computing...`);
      const result = await computeAndStorePitchingScores(season);
      console.log(`[autoCompute] Pitchers done: ${result.updated} updated, ${result.errors} errors`);
    }
  } catch (err) {
    console.error("[autoCompute] Error:", err);
  } finally {
    _autoComputeRunning = false;
  }
}
