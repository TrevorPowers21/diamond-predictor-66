import { supabase } from "@/integrations/supabase/client";

/**
 * Marks all player_predictions rows from seasons older than projectionSeason
 * as status='stale'. Should run as the first step of the recompute cascade,
 * before createPredictionsFromMaster writes new rows.
 *
 * Covers all variants (regular + precomputed) and all model_types (returner +
 * transfer). Idempotent — safe to run on every upload, including repeated
 * mid-season uploads where projectionSeason hasn't changed.
 *
 * Season rollover flow:
 *   - Mid-season uploads (same projectionSeason): only stales older seasons,
 *     no-ops for the current projection season since UPSERT handles it.
 *   - Season transition (e.g., 2027→2028): stales all 2027 rows before the
 *     cascade writes fresh 2028 rows — prevents dual-active collisions that
 *     cause the TB returner season pickup bug.
 */
export async function markOldProjectionsStale(projectionSeason: number): Promise<{ marked: number }> {
  const { data, error } = await supabase
    .from("player_predictions")
    .update({ status: "stale" })
    .lt("season", projectionSeason)
    .eq("status", "active")
    .select("id");

  if (error) throw new Error(`markOldProjectionsStale failed: ${error.message}`);

  const marked = data?.length ?? 0;
  console.log(`  marked ${marked} prediction rows stale (season < ${projectionSeason})`);
  return { marked };
}
