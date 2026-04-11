import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One row per pitch type per handedness for a pitcher in a given season.
 * Pulled from `pitcher_stuff_plus_inputs` (NEW Supabase table that user is
 * still building manually). Until populated, returns an empty array.
 */
export interface PitcherStuffPlusRow {
  pitch_type: string;
  rstr_pitch_class: string | null;
  hand: string | null;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  whiff_pct: number | null;
  stuff_plus: number | null;
}

export function usePitcherStuffPlus(
  sourcePlayerId: string | null | undefined,
  season: number = 2025,
) {
  return useQuery({
    queryKey: ["savant_pitcher_stuff_plus", sourcePlayerId, season],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      // Cast: table may not exist yet in supabase types until user creates it
      const { data, error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .select(
          "pitch_type, rstr_pitch_class, hand, pitches, velocity, ivb, hb, rel_height, rel_side, extension, spin, whiff_pct, stuff_plus",
        )
        .eq("source_player_id", sourcePlayerId!)
        .eq("season", season)
        .order("pitches", { ascending: false });
      // If the table doesn't exist yet, swallow the error and return empty.
      if (error) return [] as PitcherStuffPlusRow[];
      return (data || []) as PitcherStuffPlusRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
