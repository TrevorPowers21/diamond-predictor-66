import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lookup the Pitching Master row for one pitcher, one season. Used to surface
 * full-season aggregates (IP / ERA / FIP) on the Stats page top line as
 * static reference values that DON'T update with the dimension filter —
 * coaches see season ERA alongside filter-aware K%/BB% / BAA.
 */
export interface PitcherMasterRow {
  Season: number;
  IP: number | null;
  G: number | null;
  GS: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  Role: string | null;
  Conference: string | null;
  Team: string | null;
}

export function usePitcherMaster(
  sourcePlayerId: string | null | undefined,
  season: number,
) {
  return useQuery({
    queryKey: ["pitcher_master_row", sourcePlayerId, season],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<PitcherMasterRow | null> => {
      const { data, error } = await (supabase as any)
        .from("Pitching Master")
        .select("Season, IP, G, GS, ERA, FIP, WHIP, K9, BB9, HR9, Role, Conference, Team")
        .eq("source_player_id", sourcePlayerId!)
        .eq("Season", season)
        .maybeSingle();
      if (error) return null;
      return (data ?? null) as PitcherMasterRow | null;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
