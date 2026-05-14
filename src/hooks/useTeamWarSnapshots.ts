import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TeamWarSnapshot = {
  id: string;
  season: number;
  source_team_id: string;
  team_name: string;
  conference: string | null;
  is_national_champ: boolean;
  is_conference_champ: boolean;
  raw_total_owar: number;
  raw_total_pwar: number;
  raw_starting_lineup_owar: number;
  raw_rotation_pwar: number;
  raw_bullpen_pwar: number;
  prorated_total_owar: number;
  prorated_total_pwar: number;
  prorated_starting_lineup_owar: number;
  prorated_rotation_pwar: number;
  prorated_bullpen_pwar: number;
  games_played_est: number | null;
  proration_factor: number | null;
  n_hitters: number | null;
  n_pitchers: number | null;
};

/**
 * Single team's WAR snapshot for a given season.
 * Used by Year-over-Year compare card in TB Analytics tab.
 *
 * Resolution order — tries every reasonable identifier because the snapshot
 * was keyed on Hitter Master."TeamID" (a UUID) while the Teams Table uses
 * a different source_id format for some teams (e.g. Georgia: short numeric
 * "226" in teams, UUID "f6dce..." in Hitter Master). We try:
 *   1. Exact source_team_id match
 *   2. Exact team_name match (any of the candidates passed in)
 *   3. Strip "University of " prefix and retry (covers "University of Georgia" → "Georgia")
 */
export function useTeamWarSnapshot(
  sourceTeamId: string | null | undefined,
  season: number,
  nameCandidates: Array<string | null | undefined> = [],
) {
  const cleanCandidates = nameCandidates
    .map((n) => (n ?? "").trim())
    .filter((n) => n.length > 0)
    .flatMap((n) => {
      const variants = new Set<string>();
      variants.add(n);
      // Strip common prefixes
      variants.add(n.replace(/^university of\s+/i, "").trim());
      variants.add(n.replace(/^the\s+/i, "").trim());
      // Strip common suffixes (e.g. "Georgia State University" → "Georgia State")
      variants.add(n.replace(/\s+university$/i, "").trim());
      return Array.from(variants).filter((v) => v.length > 0);
    });
  const uniqueNames = Array.from(new Set(cleanCandidates));

  return useQuery({
    queryKey: ["team-war-snapshot", sourceTeamId, season, uniqueNames.join("|")],
    enabled: !!sourceTeamId || uniqueNames.length > 0,
    queryFn: async (): Promise<TeamWarSnapshot | null> => {
      // Step 1: source_team_id
      if (sourceTeamId) {
        const { data, error } = await (supabase as any)
          .from("team_war_snapshots")
          .select("*")
          .eq("source_team_id", sourceTeamId)
          .eq("season", season)
          .maybeSingle();
        if (error) {
          console.warn("useTeamWarSnapshot source_team_id lookup error", error);
        }
        if (data) return data as TeamWarSnapshot;
      }
      // Step 2: try every name variant in one OR query (case-insensitive)
      if (uniqueNames.length > 0) {
        // PostgREST OR with ilike: team_name.ilike.Georgia,team_name.ilike.University of Georgia
        const orClause = uniqueNames
          .map((n) => `team_name.ilike.${n.replace(/,/g, "")}`)
          .join(",");
        const { data, error } = await (supabase as any)
          .from("team_war_snapshots")
          .select("*")
          .or(orClause)
          .eq("season", season)
          .limit(1);
        if (error) {
          console.warn("useTeamWarSnapshot team_name fallback error", error);
        }
        if (data && data.length > 0) return data[0] as TeamWarSnapshot;
      }
      return null;
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * All championship benchmarks (national champ + conference champs) for a season.
 * Used by Championship Benchmark compare card in TB Analytics tab.
 *
 * Returns champions sorted by prorated_war (national first, then by conference).
 */
export function useWarBenchmarks(season: number) {
  return useQuery({
    queryKey: ["war-benchmarks", season],
    queryFn: async (): Promise<TeamWarSnapshot[]> => {
      const { data, error } = await (supabase as any)
        .from("team_war_snapshots")
        .select("*")
        .eq("season", season)
        .or("is_national_champ.eq.true,is_conference_champ.eq.true")
        .order("is_national_champ", { ascending: false })
        .order("conference", { ascending: true })
        .order("prorated_total_owar", { ascending: false });
      if (error) {
        console.warn("useWarBenchmarks fetch error", error);
        return [];
      }
      return (data ?? []) as TeamWarSnapshot[];
    },
    staleTime: 30 * 60 * 1000,
  });
}
