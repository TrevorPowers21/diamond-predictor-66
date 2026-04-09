import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type StorageSeedRow = {
  id: string;
  player_id: string | null;
  playerName: string;
  team: string | null;
  conference: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  source: string;
  teamId?: string | null;
  conferenceId?: string | null;
};

export type PowerRatingsSeedRow = {
  id: string;
  player_id: string | null;
  playerName: string;
  team: string | null;
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la10_30: number | null;
  gb: number | null;
  source: string;
  position?: string | null;
};

export type ExitPositionsSeed = Record<string, string>;

/**
 * Returns hitter seed data from the unified "Hitter Master" Supabase table.
 * The returned shape matches what all existing consumers expect.
 */
export function useHitterSeedData() {
  const { data: dbRows = [] } = useQuery({
    queryKey: ["hitter_master_2025"],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("Hitter Master")
          .select("source_player_id, playerFullName, Team, TeamID, Conference, conference_id, Season, Pos, BatHand, ThrowHand, AVG, OBP, SLG, ISO, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb, ab")
          .eq("Season", 2025)
          .gte("ab", 75)
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

  const hitterStats: StorageSeedRow[] = dbRows.map((r: any) => ({
    id: `hm-${r.source_player_id ?? r.playerFullName}-${r.Team ?? ""}`,
    player_id: r.source_player_id ?? null,
    playerName: r.playerFullName,
    team: r.Team,
    conference: r.Conference,
    avg: r.AVG,
    obp: r.OBP,
    slg: r.SLG,
    source: "hitter_master",
    teamId: r.TeamID ?? null,
    conferenceId: r.conference_id ?? null,
  }));

  const powerRatings: PowerRatingsSeedRow[] = dbRows.map((r: any) => ({
    id: `hm-${r.source_player_id ?? r.playerFullName}-${r.Team ?? ""}`,
    player_id: r.source_player_id ?? null,
    playerName: r.playerFullName,
    team: r.Team,
    contact: r.contact,
    lineDrive: r.line_drive,
    avgExitVelo: r.avg_exit_velo,
    popUp: r.pop_up,
    bb: r.bb,
    chase: r.chase,
    barrel: r.barrel,
    ev90: r.ev90,
    pull: r.pull,
    la10_30: r.la_10_30,
    gb: r.gb,
    source: "hitter_master",
    position: r.Pos ?? null,
  }));

  const exitPositions: ExitPositionsSeed = Object.fromEntries(
    dbRows
      .filter((r: any) => r.Pos)
      .flatMap((r: any) => {
        const entries: [string, string][] = [[r.playerFullName, r.Pos!]];
        if (r.Team) entries.push([`${r.playerFullName}|${r.Team}`, r.Pos!]);
        return entries;
      }),
  );

  return { hitterStats, powerRatings, exitPositions };
}
