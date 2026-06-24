import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PitchLogDimensionKey } from "@/savant/lib/pitchLogRates";

export interface PitchLogHitterByPitchTypeRow {
  batter_id: string;
  season: number;
  pitch_type_reclassified: string;
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
  pitches: number;
  swings: number;
  whiffs: number;
  chases: number;
  in_zone: number;
  in_zone_swings: number;
  in_zone_whiffs: number;
  fouls: number;
  batted_balls_in_play: number;
  batted_barrels: number;
  batted_hard_hit: number;
  ev_sum: number | null;
  batted_balls_with_ev: number;
  max_ev: number | null;
  x_hits_sum: number | null;
  x_bases_sum: number | null;
  x_woba_sum: number | null;
}

export function usePitchLogHitterByPitchType(
  batterId: string | null | undefined,
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_hitter_by_pitch_type", batterId, season, dimension],
    enabled: !!batterId,
    queryFn: async (): Promise<PitchLogHitterByPitchTypeRow[]> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_hitter_by_pitch_type")
        .select("*")
        .eq("batter_id", batterId!)
        .eq("season", season)
        .eq("dimension_key", dimension)
        .order("pitches", { ascending: false });
      if (error) return [];
      return (data ?? []) as PitchLogHitterByPitchTypeRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
