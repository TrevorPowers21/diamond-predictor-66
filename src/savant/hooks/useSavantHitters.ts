import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Raw hitter row used by Savant. Mirrors the Hitter Master columns we care
 * about for percentile calculations and the player page header.
 *
 * READ ONLY — Savant never writes to Hitter Master.
 */
export interface SavantHitterRow {
  source_player_id: string | null;
  playerFullName: string;
  Team: string | null;
  TeamID: string | null;
  Conference: string | null;
  Pos: string | null;
  BatHand: string | null;
  ThrowHand: string | null;
  Season: number | null;
  pa: number | null;
  ab: number | null;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  ISO: number | null;
  avg_exit_velo: number | null;
  ev90: number | null;
  barrel: number | null;
  bb: number | null;
  chase: number | null;
  contact: number | null;
  line_drive: number | null;
  la_10_30: number | null;
  gb: number | null;
  pull: number | null;
}

const SELECT_COLS =
  "source_player_id, playerFullName, Team, TeamID, Conference, Pos, BatHand, ThrowHand, Season, pa, ab, AVG, OBP, SLG, ISO, avg_exit_velo, ev90, barrel, bb, chase, contact, line_drive, la_10_30, gb, pull";

/**
 * Minimum AB to be included in the Savant percentile population.
 * Tuned to roughly mirror NCAA qualifying-hitter conventions; adjust later if needed.
 */
export const SAVANT_MIN_AB = 50;

export function useSavantHitters(season = 2025) {
  return useQuery({
    queryKey: ["savant_hitters", season, "v3-la"],
    queryFn: async () => {
      const all: SavantHitterRow[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("Hitter Master")
          .select(SELECT_COLS)
          .eq("Season", season)
          .gt("ab", 0)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data || []) as unknown as SavantHitterRow[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
