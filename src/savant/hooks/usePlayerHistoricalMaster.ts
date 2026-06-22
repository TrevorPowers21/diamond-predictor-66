import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subset of Hitter Master columns we need for the year-over-year row
 * display on the Stats page. NOT every metric in pitch_log has an
 * equivalent here — some (IZ Whiff%, Zone%) will render "—" for old
 * seasons. The mapping lives in pitchLogRates.ts (historicalHitter*).
 */
export interface HitterMasterHistoricalRow {
  Season: number;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  ISO: number | null;
  contact: number | null;
  chase: number | null;
  barrel: number | null;
  avg_exit_velo: number | null;
  ev90: number | null;
  la_10_30: number | null;
  gb: number | null;
  line_drive: number | null;
  pop_up: number | null;
  bb: number | null;
  k_pct: number | null;
  pa: number | null;
}

export interface PitcherMasterHistoricalRow {
  Season: number;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  IP: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  stuff_plus: number | null;
}

const HITTER_COLS =
  'Season, AVG, OBP, SLG, ISO, contact, chase, barrel, avg_exit_velo, ev90, la_10_30, gb, line_drive, pop_up, bb, k_pct, pa';

const PITCHER_COLS =
  'Season, ERA, FIP, WHIP, K9, BB9, HR9, IP, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, exit_vel, ground_pct, stuff_plus';

export function useHitterHistoricalMaster(sourcePlayerId: string | null | undefined) {
  return useQuery({
    queryKey: ["hitter_historical_master", sourcePlayerId],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<HitterMasterHistoricalRow[]> => {
      const { data, error } = await (supabase as any)
        .from("Hitter Master")
        .select(HITTER_COLS)
        .eq("source_player_id", sourcePlayerId!)
        .order("Season", { ascending: true });
      if (error) return [];
      return (data ?? []) as HitterMasterHistoricalRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePitcherHistoricalMaster(sourcePlayerId: string | null | undefined) {
  return useQuery({
    queryKey: ["pitcher_historical_master", sourcePlayerId],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<PitcherMasterHistoricalRow[]> => {
      const { data, error } = await (supabase as any)
        .from("Pitching Master")
        .select(PITCHER_COLS)
        .eq("source_player_id", sourcePlayerId!)
        .order("Season", { ascending: true });
      if (error) return [];
      return (data ?? []) as PitcherMasterHistoricalRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
