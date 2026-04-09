import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One row per season for a single pitcher. Pulled from Pitching Master by
 * source_player_id. Read-only.
 */
export interface PitcherCareerRow {
  Season: number | null;
  Team: string | null;
  Conference: string | null;
  Role: string | null;
  IP: number | null;
  G: number | null;
  GS: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  // Scouting / contact-quality (used by percentile bars, not the pitcher scouting table)
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  vel_90th: number | null;
  stuff_plus: number | null;
}

const SELECT_COLS = `Season, Team, Conference, Role, IP, G, GS, ERA, FIP, WHIP, K9, BB9, HR9, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, exit_vel, ground_pct, "90th_vel", stuff_plus`;

export function usePitcherCareer(sourcePlayerId: string | null | undefined) {
  return useQuery({
    queryKey: ["savant_pitcher_career", sourcePlayerId],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Pitching Master")
        .select(SELECT_COLS)
        .eq("source_player_id", sourcePlayerId!)
        .order("Season", { ascending: true });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({ ...r, vel_90th: r["90th_vel"] ?? null })) as PitcherCareerRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
