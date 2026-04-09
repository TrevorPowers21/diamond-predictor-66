import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One row per season for a single player. Pulled directly from Hitter Master
 * by source_player_id, ordered newest first. Read-only.
 */
export interface PlayerCareerRow {
  Season: number | null;
  Team: string | null;
  Conference: string | null;
  Pos: string | null;
  pa: number | null;
  ab: number | null;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  ISO: number | null;
  // Scouting / contact metrics for the year-over-year data table
  avg_exit_velo: number | null;
  ev90: number | null;
  barrel: number | null;
  contact: number | null;
  line_drive: number | null;
  la_10_30: number | null;
  gb: number | null;
  pull: number | null;
  bb: number | null;
  chase: number | null;
  pop_up: number | null;
  // Internal power ratings (computed by Compute Scores)
  ba_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  overall_plus: number | null;
}

const SELECT_COLS =
  "Season, Team, Conference, Pos, pa, ab, AVG, OBP, SLG, ISO, avg_exit_velo, ev90, barrel, contact, line_drive, la_10_30, gb, pull, bb, chase, pop_up, ba_plus, obp_plus, iso_plus, overall_plus";

/**
 * Fetches every Hitter Master row for one source_player_id, newest season first.
 * Used to render the career stats + year-over-year data tables on the player page.
 */
export function usePlayerCareer(sourcePlayerId: string | null | undefined) {
  return useQuery({
    queryKey: ["savant_player_career", sourcePlayerId],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Hitter Master")
        .select(SELECT_COLS)
        .eq("source_player_id", sourcePlayerId!)
        .order("Season", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PlayerCareerRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
