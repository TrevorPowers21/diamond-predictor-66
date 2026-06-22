import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PitchLogDimensionKey } from "@/savant/lib/pitchLogRates";

export interface PitchLogPitcherTotalsRow {
  pitcher_id: string;
  season: number;
  dimension_key: PitchLogDimensionKey;
  total_pitches: number;
  total_swings: number;
  total_takes: number;
  total_data_pitches: number;
  total_velo_pitches: number;
  total_in_zone: number;
  total_in_zone_swings: number;
  total_in_zone_whiffs: number;
  total_chases: number;
  total_whiffs: number;
  total_strikes: number;
  total_fouls: number;
  total_called_strikes: number;
  total_bf: number;
  total_pa: number;
  total_k: number;
  total_bb: number;
  total_hbp: number;
  stuff_plus_sum: number | null;
  stuff_plus_data_pitches: number;
}

export interface PitchLogHitterTotalsRow {
  batter_id: string;
  season: number;
  dimension_key: PitchLogDimensionKey;
  pa: number;
  ab: number;
  hits_single: number;
  hits_double: number;
  hits_triple: number;
  hits_hr: number;
  k: number;
  bb: number;
  hbp: number;
  sac: number;
  total_pitches: number;
  total_swings: number;
  total_takes: number;
  total_data_pitches: number;
  total_velo_pitches: number;
  total_in_zone: number;
  total_in_zone_swings: number;
  total_in_zone_whiffs: number;
  total_chases: number;
  total_whiffs: number;
  total_fouls: number;
  batted_balls_in_play: number;
  batted_ground_balls: number;
  batted_line_drives: number;
  batted_fly_balls: number;
  batted_pop_ups: number;
  batted_barrels: number;
  batted_hard_hit: number;
  batted_la_10_to_30: number;
  ev_sum: number | null;
  batted_balls_with_ev: number;
}

const SHARED_QUERY_OPTS = {
  staleTime: 30 * 60 * 1000,
  gcTime: 60 * 60 * 1000,
  refetchOnWindowFocus: false,
} as const;

export function usePitchLogPitcherTotals(
  pitcherId: string | null | undefined,
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_pitcher_totals", pitcherId, season, dimension],
    enabled: !!pitcherId,
    queryFn: async (): Promise<PitchLogPitcherTotalsRow | null> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_pitcher_totals")
        .select("*")
        .eq("pitcher_id", pitcherId!)
        .eq("season", season)
        .eq("dimension_key", dimension)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as PitchLogPitcherTotalsRow | null;
    },
    ...SHARED_QUERY_OPTS,
  });
}

export function usePitchLogHitterTotals(
  batterId: string | null | undefined,
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_hitter_totals", batterId, season, dimension],
    enabled: !!batterId,
    queryFn: async (): Promise<PitchLogHitterTotalsRow | null> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_hitter_totals")
        .select("*")
        .eq("batter_id", batterId!)
        .eq("season", season)
        .eq("dimension_key", dimension)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as PitchLogHitterTotalsRow | null;
    },
    ...SHARED_QUERY_OPTS,
  });
}
