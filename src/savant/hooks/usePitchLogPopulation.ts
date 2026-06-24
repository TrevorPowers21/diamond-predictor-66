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
 * MUST paginate — Supabase's default response cap is 1,000 rows, which
 * silently truncated the population (2026 pitcher pop is ~5,400; hitter
 * pop is ~6,100). That made percentile bars rank players against a
 * biased subset and diverge from Overview's percentile-rank scouting
 * grades that DID paginate. Bug discovered 2026-06-23 while aligning
 * Overview/Stats percentile displays.
 *
 * Page weight: ~5,400 pitcher rows / ~6,100 hitter rows for 2026, all
 * stats columns. A few hundred KB over the wire. Cached for 30 min.
 */
async function fetchAllPages<T>(
  table: string,
  season: number,
  dimension: PitchLogDimensionKey,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select("*")
      .eq("season", season)
      .eq("dimension_key", dimension)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

export function usePitchLogPitcherPopulation(
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_pitcher_population", season, dimension],
    queryFn: () =>
      fetchAllPages<PitchLogPitcherTotalsRow>(
        "pitch_log_pitcher_totals",
        season,
        dimension,
      ),
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
    queryFn: () =>
      fetchAllPages<PitchLogHitterTotalsRow>(
        "pitch_log_hitter_totals",
        season,
        dimension,
      ),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
