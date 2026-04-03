import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PitchingMasterSeedRow = {
  id: string;
  source_player_id: string | null;
  playerName: string;
  team: string | null;
  teamId: string | null;
  conference: string | null;
  conferenceId: string | null;
  throwHand: string | null;
  role: string | null;
  ip: number | null;
  g: number | null;
  gs: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  line_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  in_zone_pct: number | null;
  vel_90th: number | null;
  h_pull_pct: number | null;
  la_10_30_pct: number | null;
};

/**
 * Returns pitching seed data from the unified "Pitching Master" Supabase table.
 * Combines what was previously split across pitching_stats_storage and pitching_power_ratings_storage.
 */
export function usePitchingSeedData(season = 2025) {
  const { data: dbRows = [], isLoading } = useQuery({
    queryKey: ["pitching_master", season],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("Pitching Master")
          .select("*")
          .eq("Season", season)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const pitchers: PitchingMasterSeedRow[] = dbRows.map((r: any) => ({
    id: r.source_player_id || `pm-${r.playerFullName}-${r.Team ?? ""}`,
    source_player_id: r.source_player_id ?? null,
    playerName: r.playerFullName,
    team: r.Team ?? null,
    teamId: r.TeamID ?? null,
    conference: r.Conference ?? null,
    conferenceId: r.conference_id ?? null,
    throwHand: r.ThrowHand ?? null,
    role: r.Role ?? null,
    ip: r.IP ?? null,
    g: r.G ?? null,
    gs: r.GS ?? null,
    era: r.ERA ?? null,
    fip: r.FIP ?? null,
    whip: r.WHIP ?? null,
    k9: r.K9 ?? null,
    bb9: r.BB9 ?? null,
    hr9: r.HR9 ?? null,
    miss_pct: r.miss_pct ?? null,
    bb_pct: r.bb_pct ?? null,
    hard_hit_pct: r.hard_hit_pct ?? null,
    in_zone_whiff_pct: r.in_zone_whiff_pct ?? null,
    chase_pct: r.chase_pct ?? null,
    barrel_pct: r.barrel_pct ?? null,
    line_pct: r.line_pct ?? null,
    exit_vel: r.exit_vel ?? null,
    ground_pct: r.ground_pct ?? null,
    in_zone_pct: r.in_zone_pct ?? null,
    vel_90th: r["90th_vel"] ?? null,
    h_pull_pct: r.h_pull_pct ?? null,
    la_10_30_pct: r.la_10_30_pct ?? null,
  }));

  return { pitchers, loading: isLoading };
}
