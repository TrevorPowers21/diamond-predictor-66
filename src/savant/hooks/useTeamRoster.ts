import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { useMemo } from "react";

export function useTeamRoster(teamId: string | undefined, season: number = 2025) {
  const { teams } = useTeamsTable();

  // Resolve team UUID → source_team_id for master table lookups
  const team = useMemo(() => teams.find((t) => t.id === teamId), [teams, teamId]);
  const sourceId = team?.source_team_id ?? null;
  const teamName = team?.fullName ?? null;

  const { data: hitters = [], isLoading: hLoading } = useQuery({
    queryKey: ["team-roster-hitters", teamId, sourceId, teamName, season],
    enabled: !!(sourceId || teamName),
    queryFn: async () => {
      // Try by TeamID (source_id) first, fall back to team name
      if (sourceId) {
        const { data } = await (supabase as any)
          .from("Hitter Master")
          .select("*")
          .eq("TeamID", sourceId)
          .eq("Season", season)
          .order("pa", { ascending: false });
        if (data && data.length > 0) return data;
      }
      if (teamName) {
        const { data } = await (supabase as any)
          .from("Hitter Master")
          .select("*")
          .eq("Team", teamName)
          .eq("Season", season)
          .order("pa", { ascending: false });
        return data || [];
      }
      return [];
    },
    staleTime: 30 * 60 * 1000,
  });

  const { data: pitchers = [], isLoading: pLoading } = useQuery({
    queryKey: ["team-roster-pitchers", teamId, sourceId, teamName, season],
    enabled: !!(sourceId || teamName),
    queryFn: async () => {
      if (sourceId) {
        const { data } = await (supabase as any)
          .from("Pitching Master")
          .select("*")
          .eq("TeamID", sourceId)
          .eq("Season", season)
          .order("IP", { ascending: false });
        if (data && data.length > 0) return data;
      }
      if (teamName) {
        const { data } = await (supabase as any)
          .from("Pitching Master")
          .select("*")
          .eq("Team", teamName)
          .eq("Season", season)
          .order("IP", { ascending: false });
        return data || [];
      }
      return [];
    },
    staleTime: 30 * 60 * 1000,
  });

  return { team, hitters, pitchers, isLoading: hLoading || pLoading };
}
