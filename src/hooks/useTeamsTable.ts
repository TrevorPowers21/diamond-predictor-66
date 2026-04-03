import { useState, useEffect, useMemo } from "react";
import { fetchTeamsTable, type TeamsTableRow } from "@/lib/supabaseQueries";

/** Compatibility shape matching what consumers expect from the old "teams" table */
export type TeamRowCompat = {
  id: string;
  name: string;
  conference: string | null;
  conference_id: string | null;
  park_factor: number | null;
  source_team_id: string | null;
  abbreviation: string | null;
  season: number;
};

function toCompat(row: TeamsTableRow): TeamRowCompat {
  return {
    id: row.id,
    name: row.full_name,
    conference: row.conference,
    conference_id: row.conference_id,
    park_factor: null, // park factors now come from "Park Factors" table via useParkFactors
    source_team_id: row.source_id,
    abbreviation: row.abbreviation,
    season: row.season,
  };
}

export function useTeamsTable(season?: number) {
  const [teams, setTeams] = useState<TeamRowCompat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTeamsTable(season)
      .then((data) => {
        if (!cancelled) setTeams(data.map(toCompat));
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [season]);

  const teamsByName = useMemo(() => {
    const map = new Map<string, TeamRowCompat>();
    for (const t of teams) {
      map.set(t.name.toLowerCase().trim(), t);
    }
    return map;
  }, [teams]);

  return { teams, teamsByName, loading };
}
