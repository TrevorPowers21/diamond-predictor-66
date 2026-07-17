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

export interface HitterBatSpeedLite {
  bat_speed_floor: number | null;
  squared_up_rate: number | null;
}

/**
 * The whole hitter-season bat-speed population, as a Map keyed by batter_id
 * (= source_player_id). Used to merge inferred bat speed / squared-up onto the
 * Stats-page batted-ball rows so they percentile against the same population as
 * every other bar. Only the two base metrics are needed for display (the stored
 * percentile columns aren't required for this surface).
 */
export function useHitterBatSpeedPopulation(season: number) {
  return useQuery({
    queryKey: ["hitter-bat-speed-pop", season],
    queryFn: async (): Promise<Map<string, HitterBatSpeedLite>> => {
      const out = new Map<string, HitterBatSpeedLite>();
      let from = 0;
      for (;;) {
        const { data, error } = await (supabase as any)
          .from("hitter_bat_speed_season")
          .select("batter_id, bat_speed_floor, squared_up_rate")
          .eq("season", season)
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data || []) out.set(String(r.batter_id), { bat_speed_floor: r.bat_speed_floor, squared_up_rate: r.squared_up_rate });
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
    staleTime: 30 * 60 * 1000,
  });
}
