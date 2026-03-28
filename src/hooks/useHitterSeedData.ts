import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import storage2025Seed from "@/data/storage_2025_seed.json";
import powerRatings2025Seed from "@/data/power_ratings_2025_seed.json";
import exitPositions2025Seed from "@/data/exit_positions_2025_seed.json";

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
};

export type ExitPositionsSeed = Record<string, string>;

/**
 * Returns hitter seed data sourced from Supabase when available,
 * falling back to the local JSON seed files. The returned shape is
 * identical to the seed JSON so all existing lookup logic is unchanged.
 * When player_id is available (linked via admin sync), it is included
 * on each row for instant UUID-based lookups.
 */
export function useHitterSeedData() {
  const { data: dbStats = [] } = useQuery({
    queryKey: ["hitter_stats_storage_2025"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hitter_stats_storage")
        .select("player_id, player_name, team, conference, avg, obp, slg, source")
        .eq("season", 2025);
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: dbPower = [] } = useQuery({
    queryKey: ["hitting_power_ratings_storage_2025"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hitting_power_ratings_storage")
        .select("player_id, player_name, team, position, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb, source")
        .eq("season", 2025);
      if (error) throw error;
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  const hitterStats: StorageSeedRow[] = dbStats.length > 0
    ? dbStats.map((r) => ({
        id: `db-${r.player_name}-${r.team ?? ""}`,
        player_id: r.player_id ?? null,
        playerName: r.player_name,
        team: r.team,
        conference: r.conference,
        avg: r.avg,
        obp: r.obp,
        slg: r.slg,
        source: r.source ?? "supabase",
      }))
    : (storage2025Seed as any[]).map((r) => ({ ...r, player_id: null })) as StorageSeedRow[];

  const powerRatings: PowerRatingsSeedRow[] = dbPower.length > 0
    ? dbPower.map((r) => ({
        id: `db-${r.player_name}-${r.team ?? ""}`,
        player_id: r.player_id ?? null,
        playerName: r.player_name,
        team: r.team,
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
        source: r.source ?? "supabase",
      }))
    : (powerRatings2025Seed as any[]).map((r) => ({ ...r, player_id: null })) as PowerRatingsSeedRow[];

  const exitPositions: ExitPositionsSeed = dbPower.length > 0
    ? Object.fromEntries(
        dbPower
          .filter((r) => r.position)
          .flatMap((r) => {
            const entries: [string, string][] = [[r.player_name, r.position!]];
            if (r.team) entries.push([`${r.player_name}|${r.team}`, r.position!]);
            return entries;
          }),
      )
    : (exitPositions2025Seed as ExitPositionsSeed);

  return { hitterStats, powerRatings, exitPositions };
}
