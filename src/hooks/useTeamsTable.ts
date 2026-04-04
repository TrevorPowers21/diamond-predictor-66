import { useState, useEffect, useMemo } from "react";
import { fetchTeamsTable, type TeamsTableRow } from "@/lib/supabaseQueries";

export type TeamRowCompat = {
  id: string;
  name: string;
  fullName: string;
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
    name: row.abbreviation || row.full_name,
    fullName: row.full_name,
    conference: row.conference,
    conference_id: row.conference_id,
    park_factor: null,
    source_team_id: row.source_id,
    abbreviation: row.abbreviation,
    season: row.season,
  };
}

let _cache: TeamRowCompat[] | null = null;
let _cachePromise: Promise<TeamRowCompat[]> | null = null;

function getCached(season?: number): Promise<TeamRowCompat[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;
  _cachePromise = fetchTeamsTable(season).then((data) => {
    _cache = data.map(toCompat);
    return _cache;
  });
  return _cachePromise;
}

export function useTeamsTable(season?: number) {
  const [teams, setTeams] = useState<TeamRowCompat[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setTeams(_cache); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getCached(season)
      .then((data) => { if (!cancelled) setTeams(data); })
      .catch(() => { if (!cancelled) setTeams([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  const teamsByName = useMemo(() => {
    const map = new Map<string, TeamRowCompat>();
    for (const t of teams) {
      // Index by abbreviation (primary name used across the app)
      map.set(t.name.toLowerCase().trim(), t);
      // Also index by full_name so "Coastal Carolina University" → same row as "Coastal Carolina"
      const fullKey = (t.fullName || "").toLowerCase().trim();
      if (fullKey && !map.has(fullKey)) map.set(fullKey, t);
      // Index by UUID for direct team ID lookups
      if (t.id) map.set(t.id, t);
      // Index by source_team_id
      if (t.source_team_id) map.set(t.source_team_id, t);
    }
    return map;
  }, [teams]);

  return { teams, teamsByName, loading };
}
