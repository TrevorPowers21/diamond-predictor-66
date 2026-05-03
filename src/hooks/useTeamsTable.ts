import { useState, useEffect, useMemo } from "react";
import { fetchTeamsTable, type TeamsTableRow } from "@/lib/supabaseQueries";
import { CURRENT_SEASON } from "@/lib/seasonConstants";

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
  // DB column is "Season" (capital S); TS types show lowercase. Read both
  // so we work whether or not the types ever get regenerated.
  const seasonVal = (row as any).Season ?? (row as any).season ?? 0;
  return {
    id: row.id,
    name: row.abbreviation || row.full_name,
    fullName: row.full_name,
    conference: row.conference,
    conference_id: row.conference_id,
    park_factor: null,
    source_team_id: row.source_id,
    abbreviation: row.abbreviation,
    season: seasonVal,
  };
}

// `team_id` (Teams Table.id) is per-season — Georgia 2025 and Georgia 2026 have
// DIFFERENT UUIDs. `source_team_id` (Teams Table.source_id) is the program-level
// identifier that's stable across seasons. The hook defaults to current-season
// rows so TeamBuilder, TransferPortal, etc. resolve to the right team_id without
// any cross-season dedup hack. The current-season value comes from the shared
// CURRENT_SEASON constant so the next yearly transition is a one-line change.

let _cache: TeamRowCompat[] | null = null;
let _cachePromise: Promise<TeamRowCompat[]> | null = null;
let _cacheSeason: number | null = null;

function getCached(season: number): Promise<TeamRowCompat[]> {
  if (_cache && _cacheSeason === season) return Promise.resolve(_cache);
  if (_cachePromise && _cacheSeason === season) return _cachePromise;
  _cacheSeason = season;
  _cache = null;
  _cachePromise = fetchTeamsTable(season).then((data) => {
    _cache = data.map(toCompat);
    return _cache;
  });
  return _cachePromise;
}

export function useTeamsTable(season: number = CURRENT_SEASON) {
  const cacheHit = _cache && _cacheSeason === season;
  const [teams, setTeams] = useState<TeamRowCompat[]>(cacheHit ? (_cache as TeamRowCompat[]) : []);
  const [loading, setLoading] = useState(!cacheHit);

  useEffect(() => {
    if (_cache && _cacheSeason === season) {
      setTeams(_cache);
      setLoading(false);
      return;
    }
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
