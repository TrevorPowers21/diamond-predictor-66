import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  PitchLogHitterTotalsRow,
  PitchLogPitcherTotalsRow,
} from "@/savant/hooks/usePitchLogTotals";
import type { PitchLogDimensionKey } from "@/savant/lib/pitchLogRates";

/**
 * Pulls the full population of pitcher aggregation rows for a given
 * (season, dimension). Used by the Stats page to compute percentile ranks
 * for the active player against everyone else in the same filter.
 *
 * Page weight: ~5,400 rows for 2026, all stats columns. Roughly 1.5 MB
 * uncompressed JSON / a few hundred KB over the wire. Cached for 30 min.
 */
export function usePitchLogPitcherPopulation(
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_pitcher_population", season, dimension],
    queryFn: async (): Promise<PitchLogPitcherTotalsRow[]> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_pitcher_totals")
        .select("*")
        .eq("season", season)
        .eq("dimension_key", dimension);
      if (error) return [];
      return (data ?? []) as PitchLogPitcherTotalsRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePitchLogHitterPopulation(
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_hitter_population", season, dimension],
    queryFn: async (): Promise<PitchLogHitterTotalsRow[]> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_hitter_totals")
        .select("*")
        .eq("season", season)
        .eq("dimension_key", dimension);
      if (error) return [];
      return (data ?? []) as PitchLogHitterTotalsRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
