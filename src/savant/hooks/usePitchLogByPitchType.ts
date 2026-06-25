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
  balls: number;
  fouls: number;
  hbps_caused: number;
  walks_caused: number;
  strikeouts_caused: number;
  looking_strikeouts: number;
  swinging_strikeouts: number;
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
  batted_balls_allowed_in_play: number;
  batted_barrels_allowed: number;
  batted_hard_hit_allowed: number;
  ev_sum_allowed: number | null;
  batted_balls_allowed_with_ev: number;
  batted_ground_balls_allowed: number;
  batted_line_drives_allowed: number;
  batted_fly_balls_allowed: number;
  batted_pop_ups_allowed: number;
  hits_single_allowed: number;
  hits_double_allowed: number;
  hits_triple_allowed: number;
  hits_hr_allowed: number;
  ab: number;
  x_hits_sum_allowed: number | null;
  x_bases_sum_allowed: number | null;
  x_woba_sum_allowed: number | null;
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
