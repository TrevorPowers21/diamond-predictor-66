import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PitchLogDimensionKey } from "@/savant/lib/pitchLogRates";

export interface PitchLogByPitchTypeRow {
  pitcher_id: string;
  season: number;
  pitch_type_reclassified: string;
  dimension_key: PitchLogDimensionKey;
  pitches: number;
  swings: number;
  whiffs: number;
  in_zone: number;
  in_zone_swings: number;
  in_zone_whiffs: number;
  chases: number;
  called_strikes: number;
  data_pitches: number;
  velo_pitches: number;
  stuff_plus_sum: number | null;
  velo_sum: number | null;
  ivb_sum: number | null;
  hb_sum: number | null;
  extension_sum: number | null;
  spin_sum: number | null;
  rel_height_sum: number | null;
  rel_side_sum: number | null;
}

export function usePitchLogByPitchType(
  pitcherId: string | null | undefined,
  season: number,
  dimension: PitchLogDimensionKey,
) {
  return useQuery({
    queryKey: ["pitch_log_pitcher_by_pitch_type", pitcherId, season, dimension],
    enabled: !!pitcherId,
    queryFn: async (): Promise<PitchLogByPitchTypeRow[]> => {
      const { data, error } = await (supabase as any)
        .from("pitch_log_pitcher_by_pitch_type")
        .select("*")
        .eq("pitcher_id", pitcherId!)
        .eq("season", season)
        .eq("dimension_key", dimension)
        .order("pitches", { ascending: false });
      if (error) return [];
      return (data ?? []) as PitchLogByPitchTypeRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
