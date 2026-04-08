/**
 * Bulk job: infer class_transition for all 2025 player_predictions based on
 * how many years they've been in the system. Skips rows where the coach has
 * already manually overridden the class.
 *
 * Uses span-from-first-season logic from `inferClassTransition` in combinedStats.
 */
import { supabase } from "@/integrations/supabase/client";
import { inferClassTransition } from "@/lib/combinedStats";

export type InferResult = {
  updated: number;
  skipped: number;
  errors: number;
};

export async function inferAllClassTransitions(season = 2025): Promise<InferResult> {
  const result: InferResult = { updated: 0, skipped: 0, errors: 0 };

  // Pull all 2025 returner predictions that haven't been manually overridden,
  // joined with players to get source_player_id
  const pageSize = 500;
  let from = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("player_predictions")
      .select("id, class_transition, class_transition_overridden, players!inner(source_player_id)")
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows as any[]) {
      // Skip manually overridden rows
      if (row.class_transition_overridden) {
        result.skipped++;
        continue;
      }
      const sourceId = row.players?.source_player_id;
      if (!sourceId) {
        result.skipped++;
        continue;
      }
      const inferred = await inferClassTransition(sourceId, season);
      if (!inferred) {
        result.skipped++;
        continue;
      }
      if (inferred === row.class_transition) {
        result.skipped++;
        continue;
      }
      const { error: updErr } = await supabase
        .from("player_predictions")
        .update({ class_transition: inferred })
        .eq("id", row.id);
      if (updErr) {
        result.errors++;
      } else {
        result.updated++;
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return result;
}
