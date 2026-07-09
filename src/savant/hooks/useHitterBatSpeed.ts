import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** One hitter-season row from hitter_bat_speed_season (stored, percentile-ranked). */
export interface HitterBatSpeedRow {
  batter_id: string;
  season: number;
  qualified_bip: number;
  bat_speed_floor: number | null;
  bat_speed_ceiling: number | null;
  runway: number | null;
  squared_up_rate: number | null;
  avg_squared_up_pct: number | null;
  confidence: string | null;
  bat_speed_floor_pct: number | null;
  bat_speed_ceiling_pct: number | null;
  runway_pct: number | null;
  squared_up_rate_pct: number | null;
}

/**
 * Inferred bat speed + squared-up for one hitter-season, read straight from the
 * precomputed `hitter_bat_speed_season` table (percentiles already stored). Keyed
 * by `batter_id` = the player's source_player_id, matching `pitch_log.batter_id`.
 * Returns null when the hitter didn't clear the 30-BIP minimum.
 */
export function useHitterBatSpeed(batterId: string | null | undefined, season: number) {
  return useQuery({
    queryKey: ["hitter-bat-speed", batterId ?? null, season],
    enabled: !!batterId,
    queryFn: async (): Promise<HitterBatSpeedRow | null> => {
      const { data, error } = await (supabase as any)
        .from("hitter_bat_speed_season")
        .select("*")
        .eq("batter_id", batterId)
        .eq("season", season)
        .maybeSingle();
      if (error) throw error;
      return (data as HitterBatSpeedRow) ?? null;
    },
  });
}
